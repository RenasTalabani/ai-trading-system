const cron    = require('node-cron');
const PriceAlert = require('../models/PriceAlert');
const User       = require('../models/User');
const { sendPushNotification } = require('../services/notificationService');
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

      // Look up FCM token
      const user = await User.findById(alert.userId).select('fcmToken').lean();
      if (user?.fcmToken) {
        const dirLabel = alert.direction === 'above' ? 'risen above' : 'dropped below';
        const name     = alert.displayName || alert.asset;
        await sendPushNotification(user.fcmToken, {
          title: `🔔 Price Alert: ${name}`,
          body:  `${name} has ${dirLabel} $${alert.targetPrice.toLocaleString()}. Now at $${currentPrice.toLocaleString()}.`,
          data:  { type: 'price_alert', asset: alert.asset },
        }).catch(() => {});
      }

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
