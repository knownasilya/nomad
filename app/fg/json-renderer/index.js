const TWOMB = 2097152; // in bytes

function parse(str) {
  if (str === '') return false;
  if (str.length > TWOMB) return false; // too much json, bro
  try {
    return JSON.parse(str);
  } catch (e) {
    return false;
  }
}

var el = document.querySelector('body > pre');

// try to parse
var obj = parse(el.textContent);
if (obj) {
  var json = JSON.stringify(obj, null, 2);
  json = json.replace(
    /^(\s+)(".+":)/gim,
    (v, ws, key) => `${ws}<span style="color: green">${key}</span>`
  );
  json = json.replace(
    /<\/span> (".+")/gim,
    (v, str) => `</span> <span style="color: #555">${str}</span>`
  );
  json = json.replace(
    /^(\s+)(".+")(,?)$/gim,
    (v, ws, str, comma) =>
      `${ws}<span style="color: #555">${str}</span>${comma}`
  );
  json = json.replace(
    /<\/span> ([0-9]+)/gim,
    (v, num) => `</span> <span style="color: blue">${num}</span>`
  );
  json = json.replace(
    /^(\s+)([0-9]+)(,?)$/gim,
    (v, ws, num, comma) =>
      `${ws}<span style="color: blue">${num}</span>${comma}`
  );
  json = json.replace(
    /<\/span> (true|false)/gim,
    (v, bool) => `</span> <span style="color: red">${bool}</span>`
  );
  json = json.replace(
    /^(\s+)(true|false)(,?)$/gim,
    (v, ws, bool, comma) =>
      `${ws}<span style="color: red">${bool}</span>${comma}`
  );
  el.innerHTML = json;
}
