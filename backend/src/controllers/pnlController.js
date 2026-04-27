const { getDailyPnL } = require('../services/pnlService');

exports.getToday = async (req, res) => {
  try {
    const data = await getDailyPnL();
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
