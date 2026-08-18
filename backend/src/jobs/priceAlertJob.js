const cron    = require('node-cron');
const PriceAlert = require('../models/PriceAlert');
const { sendPushToUser } = require('../services/notificationService');
const logger  = require('../config/logger');

let _getPrices = null;
function _prices() {
  if (!_getPrices) _getPrices = require('../services/binanceService').getAllCachedPrices;
  return _getPrices();
}

// T-029 (2026-08-18, PM continuous-improvement pass): binanceService's
// getAllCachedPrices() returns `{ asset: { price, ts } }` (confirmed by
// reading binanceService.js -- priceCache.set() always stores an object,
// never a bare number), but this job was comparing that whole object
// directly against alert.targetPrice (`currentPrice >= alert.targetPrice`
// where currentPrice was `{price, ts}`). An object compared to a number
// coerces to "[object Object]" -> NaN -> every comparison is false. That
// made `triggered` always false, silently and permanently -- Price
// Alerts (the entire point of this job) never fired for any user, ever,
// with no error or log trace. Fixed by extracting the numeric price.
async function checkAlerts() {
  try {
    const prices = _prices();
    if (!prices || Object.keys(prices).length === 0) return;

    const alerts = await PriceAlert.find({ active: true }).lean();
    if (!alerts.length) return;

    for (const alert of alerts) {
      const cached = prices[alert.asset];
      const currentPrice = typeof cached === 'object' && cached !== null
        ? cached.price
        : cached;
      if (!currentPrice || isNaN(currentPrice)) continue;

      const triggered =
        (alert.direction === 'above' && currentPrice >= alert.targetPrice) ||
        (alert.direction === 'below' && currentPrice <= alert.targetPrice);

      if (!triggered) continue;

      // Mark as triggered first to prevent duplicate fires
      await PriceAlert.findByIdAndUpdate(alert._id, {
        active:      false,
        triggeredAt: new Date(),
      });

      // T-029 follow-up (2026-08-18): this called `sendPushNotification`,
      // a function that does not exist anywhere in notificationService.js
      // (grepped the whole backend to confirm -- zero definitions, only
      // this one call site). Destructuring a nonexistent export silently
      // yields `undefined`, so every triggered alert would throw
      // "sendPushNotification is not a function" the instant it tried to
      // notify -- caught by the outer try/catch, but only *after* the
      // alert had already been marked inactive above, so the user would
      // never get the notification and the alert would never fire again
      // either. Fixed by using the real `sendPushToUser(userId, title,
      // body, data)` export instead, which also looks up the user's FCM
      // token itself (removing the need for the separate User.findById
      // this file used to do) and purges the token if it's since gone invalid.
      const dirLabel = alert.direction === 'above' ? 'risen above' : 'dropped below';
      const name     = alert.displayName || alert.asset;
      await sendPushToUser(
        alert.userId,
        `🔔 Price Alert: ${name}`,
        `${name} has ${dirLabel} $${alert.targetPrice.toLocaleString()}. Now at $${currentPrice.toLocaleString()}.`,
        { type: 'price_alert', asset: alert.asset },
      ).catch(() => {});

      logger.info(`[PriceAlert] fired: ${alert.asset} ${alert.direction} ${alert.targetPrice} (now ${currentPrice})`);
    }
  } catch (err) {
    logger.error(`[PriceAlert] check error: ${err.stack}`);
  }
}

function startPriceAlertJob() {
  // Run every 2 minutes
  cron.schedule('*/2 * * * *', checkAlerts);
  logger.info('[PriceAlert] job started — checks every 2 min');
}

module.exports = { startPriceAlertJob };
