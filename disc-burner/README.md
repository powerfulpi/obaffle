# Disc Master 2000

A keyboard-driven, retro terminal app for making and backing up data CDs and DVDs on Ubuntu. Browse folders, add files or whole folders, or paste a path directly. The status pulse and operation animations keep the screen active while the app works.

## Run

```bash
sudo apt install xorriso
python3 /home/aidensmith/obaffle/disc-burner/disc_burner.py --check
python3 /home/aidensmith/obaffle/disc-burner/disc_burner.py
```

On this PC, `xorriso` is also installed under `~/.local/opt/disc-burner`, so the app can run without the `apt` step. Use a terminal at least 62 columns by 14 rows. Your user must have write access to the optical drive (the `cdrom` group on Ubuntu). The app only lists optical drives; it cannot target a hard drive.

## Keys

| Key | Action |
| --- | --- |
| Up / Down | Move through files or the burn list |
| Enter | Open a folder, or add the selected file |
| Space | Add the selected file or whole folder |
| Backspace | Go to the parent folder |
| P | Paste a file or folder path |
| Tab | Switch between browser and burn list |
| D | Remove the selected burn-list item |
| I | Inspect the inserted disc and list its contents |
| K | Back up the inserted data disc to an ISO file |
| B | Select a writer and burn |
| E | Select a drive and eject its disc |
| T | Select a drive and close its tray |
| H | Show or hide hidden files |
| R | Refresh the browser |
| Q | Quit |

`LIBRARY / dropbox-site/data/library` is a shortcut at the top of the file browser. Press `Enter` or `Space` on it to open `/home/aidensmith/obaffle/dropbox-site/data/library/` and select files to burn.

## Back up a disc

Browse to the folder where you want the backup and press `K`. Select the drive, review the disc, and press `Enter`. At the destination prompt, press `Enter` to save into the current folder with a name based on the disc label. You can also type or paste an existing folder path or a new `.iso` file path. The app will never overwrite an existing file. Press `Esc` during copying to cancel.

The backup reads the data disc with `xorriso`, checks for unreadable sectors, and opens the resulting ISO to confirm that its file list matches the disc. An incomplete or failed backup is removed. Audio CDs and unreadable/non-ISO discs are not supported by this backup feature.

The disc inspector shows the media type, write state, free space, volume label, and files on a readable data disc. Press `V` there for a full read-only surface scan; this can take several minutes on a large disc. A file listing checks the catalogue, while the surface scan checks data blocks for read errors.

Before a burn, the app inspects the disc and explains what will happen:

- Blank recordable disc: type `BURN` after the ISO is built.
- Written rewritable disc: previous contents will be removed from the disc's directory; type `ERASE` to confirm. This is a quick erase and is not a secure wipe.
- Written once-recordable disc, read-only disc, or unrecognizable media: burning is blocked. Insert a blank recordable disc.

The app builds a temporary ISO and checks its size against the disc's reported capacity. It inspects the disc again before confirmation and immediately before writing in case the media changed. A successful inspection cannot guarantee that a future write will succeed. It does not burn audio CDs or create bootable discs.
