// 登入狀態存在資料庫（取代記憶體）：系統更新、重新部署或主機重開後，大家不會被登出；多台主機也能共用。
'use strict';
module.exports = function createSessionStore(session, db) {
  const Store = session && session.Store; if (!Store) return null;
  db.exec('CREATE TABLE IF NOT EXISTS http_sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_http_sessions_exp ON http_sessions(expires)');
  const qGet = db.prepare('SELECT sess,expires FROM http_sessions WHERE sid=?');
  const qSet = db.prepare('INSERT INTO http_sessions (sid,sess,expires) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expires=excluded.expires');
  const qDel = db.prepare('DELETE FROM http_sessions WHERE sid=?');
  const qTouch = db.prepare('UPDATE http_sessions SET expires=? WHERE sid=?');
  const qSweep = db.prepare('DELETE FROM http_sessions WHERE expires<?');
  const DAY = 864e5;
  const expOf = s => { const e = s?.cookie?.expires; const t = e ? new Date(e).getTime() : NaN; return Number.isFinite(t) ? t : Date.now() + DAY; };
  class SqliteStore extends Store {
    get(sid, cb) { try { const r = qGet.get(sid); if (!r) return cb(null, null); if (r.expires < Date.now()) { qDel.run(sid); return cb(null, null); } cb(null, JSON.parse(r.sess)); } catch (e) { cb(e); } }
    set(sid, s, cb) { try { qSet.run(sid, JSON.stringify(s), expOf(s)); cb && cb(null); } catch (e) { cb && cb(e); } }
    destroy(sid, cb) { try { qDel.run(sid); cb && cb(null); } catch (e) { cb && cb(e); } }
    touch(sid, s, cb) { try { qTouch.run(expOf(s), sid); cb && cb(null); } catch (e) { cb && cb(e); } }
  }
  // 每小時清掉過期的登入紀錄
  setInterval(() => { try { qSweep.run(Date.now()); } catch {} }, 3600e3).unref?.();
  try { qSweep.run(Date.now()); } catch {}
  return new SqliteStore();
};
