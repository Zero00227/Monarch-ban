module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, service: 'ban-engine', v: '4.0', ts: Date.now() });
};
