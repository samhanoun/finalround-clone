// CSS modules in Jest: every class name maps to itself (styles.panel === 'panel').
module.exports = new Proxy(
  {},
  { get: (_target, key) => (key === '__esModule' ? false : key) },
);
