// @ts-nocheck
export function getDailyKey(date = new Date()) {
  return date.toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getDailySeed(date = new Date()) {
  return (hashString(getDailyKey(date)) % 999999) + 1;
}
