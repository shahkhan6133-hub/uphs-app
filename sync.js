/* UPHS cloud sync - Firebase Realtime Database over REST (no SDK needed).
   Whole database is stored as one JSON string under /uphs. Last change wins. */
(function(){
  var cfg = window.UPHS_CONFIG || {};
  var enabled = !!(cfg.apiKey && cfg.databaseURL);
  var DBURL = (cfg.databaseURL || '').replace(/\/+$/,'');
  var chip = document.getElementById('syncChip');
  var auth = null, timer = null, busy = false, started = false;
  try { auth = JSON.parse(localStorage.getItem('uphs_auth') || 'null'); } catch(e){}

  function meta(){ try { return JSON.parse(localStorage.getItem('uphs_meta') || '{}'); } catch(e){ return {}; } }
  function setMeta(m){ try { localStorage.setItem('uphs_meta', JSON.stringify(m)); } catch(e){} }
  function status(t, c){
    if(!chip) return;
    chip.textContent = t; chip.style.background = c;
    chip.style.display = enabled ? 'inline-block' : 'none';
  }

  function api(url, opts){
    return fetch(url, opts).then(function(r){
      return r.json().then(function(j){ if(!r.ok) throw j; return j; });
    });
  }

  function signIn(email, pass){
    return api('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + cfg.apiKey, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email:email, password:pass, returnSecureToken:true})
    }).then(function(j){
      auth = {email:email, idToken:j.idToken, refreshToken:j.refreshToken, exp:Date.now() + (+j.expiresIn - 120)*1000};
      localStorage.setItem('uphs_auth', JSON.stringify(auth));
    });
  }

  function token(){
    if(!auth) return Promise.reject('nologin');
    if(Date.now() < auth.exp) return Promise.resolve(auth.idToken);
    return api('https://securetoken.googleapis.com/v1/token?key=' + cfg.apiKey, {
      method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(auth.refreshToken)
    }).then(function(j){
      auth.idToken = j.id_token; auth.refreshToken = j.refresh_token;
      auth.exp = Date.now() + (+j.expires_in - 120)*1000;
      localStorage.setItem('uphs_auth', JSON.stringify(auth));
      return auth.idToken;
    }).catch(function(e){
      if(!navigator.onLine) throw 'offline';
      auth = null; localStorage.removeItem('uphs_auth'); throw 'nologin';
    });
  }

  function fail(e){
    if(e === 'nologin'){ status('Sign in to sync', '#F59E0B'); showLogin(); }
    else if(!navigator.onLine || e === 'offline' || e instanceof TypeError){ status('Offline - saved on device', '#6B7280'); }
    else { status('Sync error', '#E11D48'); }
  }

  function push(){
    var m = meta();
    return token().then(function(t){
      return api(DBURL + '/uphs.json?auth=' + t, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ts:m.ts, json:JSON.stringify(DB)})
      });
    }).then(function(){ m.dirty = false; setMeta(m); status('Synced', '#16A34A'); });
  }

  function formBusy(){
    var a = document.activeElement, mo = document.getElementById('mo');
    return (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) || (mo && mo.style.display !== 'none');
  }

  function applyRemote(r){
    var data = JSON.parse(r.json);
    for(var k in data){ DB[k] = data[k]; }
    localStorage.setItem('uphs_db', JSON.stringify(DB));
    setMeta({ts:r.ts, dirty:false});
    if(typeof render === 'function') render();
    var hs = document.getElementById('hs');
    if(hs && DB['Students']) hs.textContent = DB['Students'].length + ' students  |  ' + DB['Teachers & Staff'].length + ' staff  |  11 modules';
    status('Synced', '#16A34A');
  }

  function sync(){
    if(!enabled || busy) return Promise.resolve();
    busy = true; status('Syncing...', '#7C3AED');
    return token().then(function(t){
      return api(DBURL + '/uphs.json?auth=' + t);
    }).then(function(r){
      var m = meta(), lts = m.ts || 0;
      if(!r || !r.json){                       // nothing online yet
        if(lts > 0) return push();
        status('Synced', '#16A34A'); return;
      }
      if(r.ts > lts){                          // online copy is newer
        if(m.dirty){
          if(confirm('Another device changed the data, and this device also has unsynced changes.\n\nOK = use the other device\'s data\nCancel = keep this device\'s data')){ return applyRemote(r); }
          m.ts = Date.now(); setMeta(m); return push();
        }
        if(formBusy()){ status('Update waiting', '#F59E0B'); return; }
        return applyRemote(r);
      }
      if(m.dirty || lts > r.ts) return push();
      status('Synced', '#16A34A');
    }).catch(fail).then(function(){ busy = false; });
  }

  function showLogin(){
    if(document.getElementById('syncLogin')) return;
    var d = document.createElement('div');
    d.id = 'syncLogin';
    d.style.cssText = 'position:fixed;inset:0;z-index:300;background:rgba(26,26,26,.55);display:flex;align-items:center;justify-content:center;padding:16px';
    d.innerHTML = '<div style="background:#fff;border-radius:20px;padding:24px;max-width:380px;width:100%;box-shadow:0 20px 50px -10px rgba(0,0,0,.4)">' +
      '<div style="font-size:18px;font-weight:700;margin-bottom:4px">Sign in to sync</div>' +
      '<div style="font-size:12px;color:#6B7280;margin-bottom:16px">Use the school sync account. Same account on every device.</div>' +
      '<input id="sl_e" type="email" placeholder="Email" autocomplete="username" style="width:100%;padding:12px;border:1px solid #E5E7EB;border-radius:12px;margin-bottom:10px;font-size:14px">' +
      '<input id="sl_p" type="password" placeholder="Password" autocomplete="current-password" style="width:100%;padding:12px;border:1px solid #E5E7EB;border-radius:12px;margin-bottom:10px;font-size:14px">' +
      '<div id="sl_m" style="color:#E11D48;font-size:12px;min-height:16px;margin-bottom:8px"></div>' +
      '<div style="display:flex;gap:10px"><button id="sl_go" type="button" class="btn" style="flex:1;justify-content:center">Sign in</button>' +
      '<button id="sl_x" type="button" class="btn" style="background:#F3F4F6;color:#374151">Skip</button></div></div>';
    document.body.appendChild(d);
    document.getElementById('sl_x').onclick = function(){ d.remove(); };
    document.getElementById('sl_go').onclick = function(){
      var e = document.getElementById('sl_e').value.trim(), p = document.getElementById('sl_p').value;
      var msg = document.getElementById('sl_m'); msg.textContent = 'Signing in...';
      signIn(e, p).then(function(){ d.remove(); sync(); }).catch(function(err){
        msg.textContent = (err && err.error && /INVALID|EMAIL|PASSWORD|CREDENTIAL/.test(err.error.message)) ? 'Wrong email or password.' : 'Could not sign in. Check internet and try again.';
      });
    };
  }

  window.uphsSync = {
    changed: function(){
      if(!enabled) return;
      var m = meta(); m.ts = Date.now(); m.dirty = true; setMeta(m);
      status('Saving...', '#7C3AED');
      clearTimeout(timer);
      timer = setTimeout(function(){ if(!auth) return fail('nologin'); busy = false; sync(); }, 1500);
    },
    start: function(){
      if(!enabled || started) return; started = true;
      if(chip){
        chip.onclick = function(){
          if(!auth){ showLogin(); return; }
          if(confirm('Signed in as ' + auth.email + '.\n\nOK = Sync now\nCancel = Sign out')){ sync(); }
          else { auth = null; localStorage.removeItem('uphs_auth'); status('Sign in to sync', '#F59E0B'); }
        };
      }
      if(!auth){ status('Sign in to sync', '#F59E0B'); showLogin(); } else { sync(); }
      document.addEventListener('visibilitychange', function(){ if(!document.hidden && auth) sync(); });
      window.addEventListener('online', function(){ if(auth) sync(); });
      window.addEventListener('offline', function(){ status('Offline - saved on device', '#6B7280'); });
      setInterval(function(){ if(auth && !document.hidden) sync(); }, 30000);
    }
  };
  window.uphsSync.start();
})();
