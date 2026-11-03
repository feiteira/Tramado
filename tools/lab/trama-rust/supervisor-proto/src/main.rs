//! Prototype: spawn Syncthing (single process via STMONITORED=yes) from a dedicated
//! supervisor thread with PR_SET_PDEATHSIG, so it dies with us even on SIGKILL.
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (bin, home, port, key) = (&args[1], &args[2], &args[3], &args[4]);
    let parent = std::process::id() as libc::pid_t;
    let mut cmd = Command::new(bin);
    cmd.args([
        "serve", "--no-browser", "--no-restart", "--no-upgrade",
        &format!("--home={home}"),
        &format!("--gui-address=127.0.0.1:{port}"),
        "--log-file=-",
    ])
    .env("STMONITORED", "yes")      // no monitor process: the pid we hold IS syncthing
    .env("STNODEFAULTFOLDER", "1")  // no ~/Sync default folder
    .env("STGUIAPIKEY", key)        // not on the command line (visible in ps)
    .stdin(Stdio::null())
    .stdout(Stdio::null())          // never a pipe nobody drains
    .stderr(Stdio::null());
    unsafe {
        cmd.pre_exec(move || {
            if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            if libc::getppid() != parent {
                libc::raise(libc::SIGTERM); // parent already gone between fork and prctl
            }
            Ok(())
        });
    }
    // PDEATHSIG fires when the *thread* that forked exits: spawn and wait on a long-lived thread.
    let sup = std::thread::spawn(move || {
        let mut child = cmd.spawn().expect("spawn");
        println!("child {}", child.id());
        let status = child.wait().expect("wait");
        println!("syncthing exited: {:?}", status.code());
    });
    sup.join().unwrap();
}
