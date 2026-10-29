// Sender alarmer som notifikation på Mac'en og/eller som mail. Ingen pakker: mail sendes med en lille SMTP-klient.
// Mail kræver SMTP_HOST, SMTP_USER, SMTP_PASS og ALERT_EMAIL_TO i .env (fx Gmail med en app-adgangskode).
const { execFile } = require('child_process');
const net = require('net');
const tls = require('tls');
const os = require('os');

const canMac = () => process.platform === 'darwin';

function macNotify(title, message) {
  if (!canMac()) return Promise.resolve(false);
  const q = (x) => '"' + String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const script = `display notification ${q(message)} with title "Min økonomi" subtitle ${q(title)} sound name "Glass"`;
  return new Promise((resolve, reject) => execFile('osascript', ['-e', script], (err) => (err ? reject(err) : resolve(true))));
}

function mailConfig() {
  const e = process.env;
  if (!e.SMTP_HOST || !e.ALERT_EMAIL_TO) return null;
  const port = Number(e.SMTP_PORT || 465);
  return { host: e.SMTP_HOST, port, secure: e.SMTP_SECURE ? e.SMTP_SECURE !== 'false' : port === 465, user: e.SMTP_USER || '', pass: e.SMTP_PASS || '', from: e.SMTP_FROM || e.SMTP_USER || e.ALERT_EMAIL_TO, to: e.ALERT_EMAIL_TO };
}

// Minimal SMTP: implicit TLS (port 465) eller STARTTLS (port 587), AUTH LOGIN
function sendMail({ subject, text }, cfg = mailConfig()) {
  if (!cfg) return Promise.reject(new Error('Mail er ikke sat op i .env'));
  return new Promise((resolve, reject) => {
    let sock = cfg.secure ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }) : net.connect({ host: cfg.host, port: cfg.port });
    sock.setTimeout(20000, () => sock.destroy(new Error('SMTP-serveren svarede ikke')));
    let buf = '';
    let waiting = null;
    const onData = (d) => {
      buf += d.toString('utf8');
      const lines = buf.split('\r\n');
      const done = lines.findIndex((l) => /^\d{3} /.test(l));
      if (done >= 0 && waiting) {
        const reply = lines.slice(0, done + 1).join('\n');
        buf = lines.slice(done + 1).join('\r\n');
        const w = waiting;
        waiting = null;
        w(reply);
      }
    };
    const fail = (e) => { sock.destroy(); reject(e); };
    sock.on('data', onData);
    sock.on('error', fail);
    const read = () => new Promise((res) => { waiting = res; onData(''); });
    const cmd = async (line, expect) => {
      if (line != null) sock.write(line + '\r\n');
      const reply = await read();
      if (!reply.startsWith(String(expect))) throw new Error(`SMTP: ${reply.split('\n').pop()}`);
      return reply;
    };
    const b64 = (x) => Buffer.from(x, 'utf8').toString('base64');
    (async () => {
      await cmd(null, 220);
      let ehlo = await cmd(`EHLO ${os.hostname() || 'localhost'}`, 250);
      if (!cfg.secure && /STARTTLS/i.test(ehlo)) {
        await cmd('STARTTLS', 220);
        sock.removeListener('data', onData);
        sock = tls.connect({ socket: sock, servername: cfg.host });
        sock.on('data', onData);
        sock.on('error', fail);
        await new Promise((res) => sock.once('secureConnect', res));
        ehlo = await cmd(`EHLO ${os.hostname() || 'localhost'}`, 250);
      }
      if (cfg.user) {
        await cmd('AUTH LOGIN', 334);
        await cmd(b64(cfg.user), 334);
        await cmd(b64(cfg.pass), 235);
      }
      await cmd(`MAIL FROM:<${cfg.from}>`, 250);
      await cmd(`RCPT TO:<${cfg.to}>`, 250);
      await cmd('DATA', 354);
      const body = b64(text).replace(/.{76}/g, '$&\r\n');
      const msg = [
        `From: Min økonomi <${cfg.from}>`.replace('Min økonomi', `=?UTF-8?B?${b64('Min økonomi')}?=`),
        `To: <${cfg.to}>`,
        `Subject: =?UTF-8?B?${b64(subject)}?=`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        body,
      ].join('\r\n');
      await cmd(msg + '\r\n.', 250);
      sock.write('QUIT\r\n');
      sock.end();
      resolve(true);
    })().catch(fail);
  });
}

// Sender nye alarmer via de kanaler, der er slået til. Returnerer hvilke kanaler der lykkedes.
async function notifyAlerts(alerts, settings = {}) {
  if (!alerts.length) return { mac: false, email: false };
  const res = { mac: false, email: false, errors: [] };
  if (settings.mac !== false && canMac()) {
    for (const a of alerts.slice(0, 3)) await macNotify(a.title, a.message).then(() => (res.mac = true), (e) => res.errors.push('Mac: ' + e.message));
    if (alerts.length > 3) await macNotify(`${alerts.length - 3} alarmer mere`, 'Åbn dashboardet for at se dem').catch(() => {});
  }
  if (settings.email !== false && mailConfig()) {
    const subject = alerts.length === 1 ? alerts[0].title : `${alerts.length} nye alarmer i din økonomi`;
    const text = alerts.map((a) => `• ${a.title}\n  ${a.message}`).join('\n\n') + '\n\nSe mere i dashboardet: http://localhost:' + (process.env.PORT || 5180) + '\n';
    await sendMail({ subject, text }).then(() => (res.email = true), (e) => res.errors.push('Mail: ' + e.message));
  }
  return res;
}

module.exports = { notifyAlerts, macNotify, sendMail, mailConfig, canMac };
