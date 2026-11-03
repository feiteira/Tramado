# Loads a page in WebKitGTK (the engine Tauri uses on Linux) and reports, per audio file:
# canPlayType, <audio> metadata (duration) and Web Audio decodeAudioData (full decode).
import json, sys, os
import gi
gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib

base = sys.argv[1]  # directory with the files
files = sys.argv[2:]
page = """<!doctype html><meta charset=utf-8><body><script>
const files = %s;
const types = ['audio/ogg; codecs=opus','audio/ogg; codecs="opus"','audio/opus','audio/webm; codecs=opus','audio/ogg; codecs=vorbis','audio/flac','audio/mpeg','audio/mp4; codecs="mp4a.40.2"','audio/wav','audio/x-m4a','audio/mp4; codecs=opus'];
const out = {ua: navigator.userAgent, canPlay: {}, files: {}};
for (const t of types) out.canPlay[t] = document.createElement('audio').canPlayType(t);
function viaElement(f) {
  return new Promise(res => {
    const a = new Audio(); a.preload = 'auto';
    const done = (r) => { a.src=''; res(r); };
    const t = setTimeout(() => done({el: 'timeout', rs: a.readyState, err: a.error && a.error.code}), 15000);
    a.onloadedmetadata = () => { clearTimeout(t); done({el: 'ok', duration: a.duration}); };
    a.onerror = () => { clearTimeout(t); done({el: 'error', code: a.error && a.error.code, msg: a.error && a.error.message}); };
    a.src = f;
  });
}
async function viaWebAudio(f) {
  try {
    const buf = await (await fetch(f)).arrayBuffer();
    const ctx = new OfflineAudioContext(1, 16000, 16000);
    const d = await ctx.decodeAudioData(buf);
    return {wa: 'ok', duration: d.duration, rate: d.sampleRate, ch: d.numberOfChannels};
  } catch (e) { return {wa: 'error', msg: String(e)}; }
}
(async () => {
  for (const f of files) out.files[f] = Object.assign(await viaElement(f), await viaWebAudio(f));
  window.webkit.messageHandlers.result.postMessage(JSON.stringify(out));
})();
</script>""" % json.dumps(files)

win = Gtk.OffscreenWindow()
ucm = WebKit2.UserContentManager()
ucm.register_script_message_handler('result')
def on_msg(_m, js):
    print(json.dumps(json.loads(js.get_js_value().to_string()), indent=1))
    Gtk.main_quit()
ucm.connect('script-message-received::result', on_msg)
wv = WebKit2.WebView.new_with_user_content_manager(ucm)
s = wv.get_settings()
s.set_allow_file_access_from_file_urls(True)
s.set_allow_universal_access_from_file_urls(True)
s.set_enable_media(True)
s.set_enable_webaudio(True)
win.add(wv)
win.show_all()

def on_title(view, _p):
    t = view.get_title() or ''
    if t.startswith('RESULT:'):
        print(json.dumps(json.loads(t[7:]), indent=1))
        Gtk.main_quit()

wv.connect('notify::title', on_title)
GLib.timeout_add_seconds(240, lambda: (print('TIMEOUT'), Gtk.main_quit()))
wv.load_html(page, 'file://' + os.path.abspath(base) + '/')
Gtk.main()
