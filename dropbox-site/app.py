import hmac
import os
import secrets
import sqlite3
import subprocess
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, abort, flash, jsonify, redirect, render_template, request, send_from_directory, session, url_for
from werkzeug.exceptions import RequestEntityTooLarge


BASE = Path(__file__).resolve().parent
DATA = Path(os.environ.get("DROP_DATA_DIR", BASE / "data"))
FILES = DATA / "files"
FILES.mkdir(parents=True, exist_ok=True)
LIBRARY = DATA / "library"
LIBRARY.mkdir(parents=True, exist_ok=True)
PREVIEWS = DATA / "previews"
PREVIEWS.mkdir(parents=True, exist_ok=True)
PARTS = DATA / "parts"
PARTS.mkdir(parents=True, exist_ok=True)
DB = DATA / "files.sqlite3"
MAX_FILE = 2 * 1024 * 1024 * 1024
CHUNK_SIZE = 8 * 1024 * 1024
EMBED_LIMIT = 9 * 1024 * 1024
PASSWORD = os.environ.get("DROP_PASSWORD", "")
SECRET = os.environ.get("DROP_SECRET", "")
if not PASSWORD or not SECRET:
    raise RuntimeError("Set DROP_PASSWORD and DROP_SECRET before starting")

app = Flask(__name__)
app.secret_key = SECRET
app.config.update(MAX_CONTENT_LENGTH=512 * 1024 * 1024, SESSION_COOKIE_HTTPONLY=True,
                  SESSION_COOKIE_SAMESITE="Lax", SESSION_COOKIE_SECURE=os.environ.get("DROP_HTTPS") == "1")


def db():
    conn = sqlite3.connect(DB, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


with db() as conn:
    conn.execute("CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, name TEXT NOT NULL, stored TEXT NOT NULL, size INTEGER NOT NULL, created TEXT NOT NULL)")
    conn.execute("CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, name TEXT NOT NULL, stored TEXT NOT NULL, size INTEGER NOT NULL, received INTEGER NOT NULL, created REAL NOT NULL)")
    conn.execute("CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL, created TEXT NOT NULL)")
    if "folder_id" not in {row["name"] for row in conn.execute("PRAGMA table_info(files)")}:
        conn.execute("ALTER TABLE files ADD COLUMN folder_id TEXT")
    if "folder_id" not in {row["name"] for row in conn.execute("PRAGMA table_info(uploads)")}:
        conn.execute("ALTER TABLE uploads ADD COLUMN folder_id TEXT")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS folders_siblings_unique ON folders (COALESCE(parent_id, ''), name COLLATE NOCASE)")
    conn.execute("CREATE INDEX IF NOT EXISTS files_folder_idx ON files (folder_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS folders_parent_idx ON folders (parent_id)")
    stale = conn.execute("SELECT stored FROM uploads WHERE created < ?", (time.time() - 86400,)).fetchall()
    for row in stale:
        (PARTS / row["stored"]).unlink(missing_ok=True)
    conn.execute("DELETE FROM uploads WHERE created < ?", (time.time() - 86400,))
    conn.commit()


def logged_in():
    return session.get("ok") is True


def clean_name(value):
    name = str(value or "").strip()
    if not name or name in (".", "..") or len(name) > 200 or any(char in name for char in "/\\\0\r\n"):
        return None
    return name


def preview_type(name):
    extension = Path(name).suffix.lower()
    image_types = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
                   ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif"}
    audio_types = {".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac",
                   ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac"}
    video_types = {".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
                   ".m4v": "video/mp4"}
    for kind, types in (("image", image_types), ("audio", audio_types), ("video", video_types)):
        if extension in types:
            return kind, types[extension]
    if extension == ".pdf":
        return "pdf", "application/pdf"
    return None, None


@app.template_filter("previewable")
def previewable(name):
    return preview_type(name)[0] is not None


def local_file_path(item):
    folder = LIBRARY / item["id"]
    folder.mkdir(exist_ok=True)
    path = folder / item["name"]
    source = FILES / item["stored"]
    if not path.is_symlink() or path.resolve() != source:
        path.unlink(missing_ok=True)
        path.symlink_to(source)
    return path


def gif_preview(item):
    if Path(item["name"]).suffix.lower() != ".gif" or item["size"] <= EMBED_LIMIT:
        return None
    target = PREVIEWS / (item["stored"] + ".gif")
    if target.is_file() and target.stat().st_size <= EMBED_LIMIT:
        return target
    source = FILES / item["stored"]
    for width, fps, colors in ((480, 12, 128), (360, 10, 96), (240, 8, 64)):
        temporary = PREVIEWS / (item["stored"] + "." + secrets.token_hex(6) + ".gif")
        filter_graph = (f"[0:v]fps={fps},scale={width}:-1:flags=lanczos,split[a][b];"
                        f"[a]palettegen=max_colors={colors}[p];[b][p]paletteuse=dither=bayer:bayer_scale=3")
        try:
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source),
                            "-filter_complex", filter_graph, "-loop", "0", str(temporary)],
                           check=True, timeout=90, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if temporary.stat().st_size <= EMBED_LIMIT:
                os.replace(temporary, target)
                return target
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            break
        finally:
            temporary.unlink(missing_ok=True)
    return None


def valid_folder(conn, folder_id):
    if not folder_id:
        return None
    if conn.execute("SELECT 1 FROM folders WHERE id = ?", (folder_id,)).fetchone() is None:
        abort(404)
    return folder_id


def folder_url(folder_id=None):
    return url_for("index", folder=folder_id) if folder_id else url_for("index")


def folder_options(folders):
    children = {}
    for folder in folders:
        children.setdefault(folder["parent_id"], []).append(folder)
    for group in children.values():
        group.sort(key=lambda row: row["name"].lower())
    options = []
    def visit(parent, prefix):
        for folder in children.get(parent, []):
            path = f"{prefix} / {folder['name']}" if prefix else folder["name"]
            options.append((folder["id"], path))
            visit(folder["id"], path)
    visit(None, "")
    return options


def descendants(folders, folder_id):
    children = {}
    for folder in folders:
        children.setdefault(folder["parent_id"], []).append(folder["id"])
    found = {folder_id}
    pending = [folder_id]
    while pending:
        for child in children.get(pending.pop(), []):
            found.add(child)
            pending.append(child)
    return found


@app.context_processor
def csrf_context():
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(24)
    return {"csrf": session["csrf"]}


@app.before_request
def check_csrf():
    supplied = request.headers.get("X-CSRF-Token", "") if request.path.startswith("/api/") else request.form.get("csrf", "")
    if request.method == "POST" and not hmac.compare_digest(supplied, session.get("csrf", "")):
        abort(403)


@app.template_filter("size")
def size_filter(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024


@app.route("/app", methods=["GET", "POST"])
def index():
    if request.method == "POST" and not logged_in():
        if hmac.compare_digest(request.form.get("password", ""), PASSWORD):
            session.clear()
            session["ok"] = True
            session["csrf"] = secrets.token_urlsafe(24)
            return redirect(url_for("index"))
        flash("That passcode didn't work.")
    if not logged_in():
        return render_template("index.html", files=None)
    with db() as conn:
        current_id = valid_folder(conn, request.args.get("folder"))
        folders = conn.execute("SELECT * FROM folders").fetchall()
        current = next((folder for folder in folders if folder["id"] == current_id), None)
        breadcrumbs = []
        node = current
        while node:
            breadcrumbs.append(node)
            node = next((folder for folder in folders if folder["id"] == node["parent_id"]), None)
        breadcrumbs.reverse()
        subfolders = [folder for folder in folders if folder["parent_id"] == current_id]
        subfolders.sort(key=lambda row: row["name"].lower())
        files = conn.execute("SELECT * FROM files WHERE folder_id IS ? ORDER BY created DESC", (current_id,)).fetchall()
    choices = folder_options(folders)
    destinations = {folder["id"]: [(fid, path) for fid, path in choices if fid not in descendants(folders, folder["id"])]
                    for folder in subfolders}
    name_counts = Counter(file["name"] for file in files)
    preview_paths = {file["id"]: ("/".join([folder["name"] for folder in breadcrumbs] + [file["name"]])
                                  if name_counts[file["name"]] == 1 else None) for file in files}
    local_paths = {file["id"]: str(local_file_path(file)) for file in files}
    return render_template("index.html", files=files, subfolders=subfolders, current_id=current_id,
                           breadcrumbs=breadcrumbs, folder_choices=choices, folder_destinations=destinations,
                           preview_paths=preview_paths, local_paths=local_paths)


@app.get("/")
def home():
    return redirect(url_for("index"))


@app.post("/folders/new")
def create_folder():
    if not logged_in():
        abort(403)
    name = clean_name(request.form.get("name"))
    if name is None:
        return "Enter a folder name without slashes, up to 200 characters.", 400
    with db() as conn:
        parent_id = valid_folder(conn, request.form.get("parent_id"))
        try:
            conn.execute("INSERT INTO folders VALUES (?, ?, ?, ?)",
                         (secrets.token_urlsafe(18), parent_id, name, datetime.now(timezone.utc).isoformat()))
            conn.commit()
        except sqlite3.IntegrityError:
            return "A folder with that name already exists here.", 409
    flash(f"Created {name}.")
    return redirect(folder_url(parent_id))


@app.post("/folders/<folder_id>/rename")
def rename_folder(folder_id):
    if not logged_in():
        abort(403)
    name = clean_name(request.form.get("name"))
    if name is None:
        return "Enter a folder name without slashes, up to 200 characters.", 400
    with db() as conn:
        valid_folder(conn, folder_id)
        try:
            conn.execute("UPDATE folders SET name = ? WHERE id = ?", (name, folder_id))
            conn.commit()
        except sqlite3.IntegrityError:
            return "A folder with that name already exists here.", 409
    flash("Folder renamed.")
    return redirect(folder_url(request.form.get("current_folder")))


@app.post("/folders/<folder_id>/move")
def move_folder(folder_id):
    if not logged_in():
        abort(403)
    with db() as conn:
        valid_folder(conn, folder_id)
        destination = valid_folder(conn, request.form.get("destination"))
        folders = conn.execute("SELECT id, parent_id FROM folders").fetchall()
        if destination in descendants(folders, folder_id):
            return "A folder cannot go inside itself or one of its subfolders.", 400
        try:
            conn.execute("UPDATE folders SET parent_id = ? WHERE id = ?", (destination, folder_id))
            conn.commit()
        except sqlite3.IntegrityError:
            return "A folder with that name already exists in the destination.", 409
    flash("Folder moved.")
    return redirect(folder_url(request.form.get("current_folder")))


@app.post("/folders/<folder_id>/delete")
def delete_folder(folder_id):
    if not logged_in():
        abort(403)
    with db() as conn:
        valid_folder(conn, folder_id)
        if conn.execute("SELECT 1 FROM folders WHERE parent_id = ?", (folder_id,)).fetchone() or conn.execute("SELECT 1 FROM files WHERE folder_id = ?", (folder_id,)).fetchone() or conn.execute("SELECT 1 FROM uploads WHERE folder_id = ?", (folder_id,)).fetchone():
            return "Move or delete the contents before deleting this folder.", 409
        conn.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
        conn.commit()
    flash("Empty folder deleted.")
    return redirect(folder_url(request.form.get("current_folder")))


@app.post("/files/<token>/rename")
def rename_file(token):
    if not logged_in():
        abort(403)
    name = clean_name(request.form.get("name"))
    if name is None:
        return "Enter a file name without slashes, up to 200 characters.", 400
    with db() as conn:
        item = conn.execute("SELECT * FROM files WHERE id = ?", (token,)).fetchone()
        if item is None:
            abort(404)
        conn.execute("UPDATE files SET name = ? WHERE id = ?", (name, token))
        conn.commit()
    if name != item["name"]:
        (LIBRARY / token / item["name"]).unlink(missing_ok=True)
        local_file_path({"id": token, "name": name, "stored": item["stored"]})
    flash("File renamed. Its share link still works.")
    return redirect(folder_url(request.form.get("current_folder")))


@app.post("/files/<token>/move")
def move_file(token):
    if not logged_in():
        abort(403)
    with db() as conn:
        if conn.execute("SELECT 1 FROM files WHERE id = ?", (token,)).fetchone() is None:
            abort(404)
        destination = valid_folder(conn, request.form.get("destination"))
        conn.execute("UPDATE files SET folder_id = ? WHERE id = ?", (destination, token))
        conn.commit()
    flash("File moved. Its share link still works.")
    return redirect(folder_url(request.form.get("current_folder")))


@app.post("/upload")
def upload():
    if not logged_in():
        abort(403)
    incoming = request.files.getlist("files")
    if not incoming or all(not item.filename for item in incoming):
        flash("Choose at least one file.")
        return redirect(url_for("index"))
    count = 0
    uploaded_tokens = []
    with db() as conn:
        folder_id = valid_folder(conn, request.form.get("folder_id"))
        for item in incoming:
            if not item.filename:
                continue
            name = clean_name(item.filename)
            if name is None:
                return "Invalid file name.", 400
            token = secrets.token_urlsafe(24)
            stored = secrets.token_hex(24)
            target = FILES / stored
            item.save(target)
            conn.execute("INSERT INTO files (id, name, stored, size, created, folder_id) VALUES (?, ?, ?, ?, ?, ?)",
                         (token, name, stored, target.stat().st_size, datetime.now(timezone.utc).isoformat(), folder_id))
            uploaded_tokens.append(token)
            count += 1
        conn.commit()
    flash(f"Uploaded {count} file{'s' if count != 1 else ''}.")
    with db() as conn:
        recent = [conn.execute("SELECT * FROM files WHERE id = ?", (token,)).fetchone() for token in uploaded_tokens]
    for saved in recent:
        gif_preview(saved)
    return redirect(folder_url(folder_id))


@app.post("/api/uploads")
def start_upload():
    if not logged_in():
        abort(403)
    data = request.get_json(silent=True) or {}
    name = clean_name(data.get("name"))
    if name is None:
        return jsonify(error="Invalid file name."), 400
    size = data.get("size")
    if not isinstance(size, int) or size < 0 or size > MAX_FILE:
        return jsonify(error="File must be 2 GB or smaller."), 400
    upload_id = secrets.token_urlsafe(24)
    stored = secrets.token_hex(24)
    with db() as conn:
        folder_id = valid_folder(conn, data.get("folder_id"))
        (PARTS / stored).touch(exist_ok=False)
        conn.execute("INSERT INTO uploads (id, name, stored, size, received, created, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                     (upload_id, name, stored, size, 0, time.time(), folder_id))
        conn.commit()
    return jsonify(id=upload_id, chunk_size=CHUNK_SIZE), 201


@app.post("/api/uploads/<upload_id>/chunks")
def upload_chunk(upload_id):
    if not logged_in():
        abort(403)
    offset = request.headers.get("X-Upload-Offset", "")
    if not offset.isdecimal():
        return jsonify(error="Missing upload offset."), 400
    offset = int(offset)
    if request.content_length is None or request.content_length > CHUNK_SIZE or request.content_length == 0:
        return jsonify(error="Chunk must be between 1 byte and 8 MB."), 400
    body = request.get_data()
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        item = conn.execute("SELECT * FROM uploads WHERE id = ?", (upload_id,)).fetchone()
        if item is None:
            abort(404)
        if offset != item["received"] or len(body) + offset > item["size"]:
            return jsonify(error="Upload is out of order."), 409
        target = PARTS / item["stored"]
        with target.open("r+b") as part:
            part.truncate(offset)
            part.seek(offset)
            part.write(body)
        received = offset + len(body)
        conn.execute("UPDATE uploads SET received = ? WHERE id = ?", (received, upload_id))
        conn.commit()
    return jsonify(received=received)


@app.post("/api/uploads/<upload_id>/finish")
def finish_upload(upload_id):
    if not logged_in():
        abort(403)
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        item = conn.execute("SELECT * FROM uploads WHERE id = ?", (upload_id,)).fetchone()
        if item is None:
            abort(404)
        part = PARTS / item["stored"]
        if item["received"] != item["size"] or part.stat().st_size != item["size"]:
            return jsonify(error="Upload is incomplete."), 409
        token = secrets.token_urlsafe(24)
        os.replace(part, FILES / item["stored"])
        conn.execute("INSERT INTO files (id, name, stored, size, created, folder_id) VALUES (?, ?, ?, ?, ?, ?)",
                     (token, item["name"], item["stored"], item["size"], datetime.now(timezone.utc).isoformat(), item["folder_id"]))
        conn.execute("DELETE FROM uploads WHERE id = ?", (upload_id,))
        conn.commit()
    with db() as conn:
        saved = conn.execute("SELECT * FROM files WHERE id = ?", (token,)).fetchone()
    gif_preview(saved)
    return jsonify(url=url_for("download", token=token, _external=True)), 201


@app.get("/f/<token>")
def download(token):
    with db() as conn:
        item = conn.execute("SELECT * FROM files WHERE id = ?", (token,)).fetchone()
    if item is None:
        abort(404)
    return send_from_directory(FILES, item["stored"], as_attachment=True, download_name=item["name"],
                               mimetype="application/octet-stream", max_age=0)


def preview_response(item):
    _, mime = preview_type(item["name"])
    if mime is None:
        return redirect(url_for("download", token=item["id"]))
    optimized = gif_preview(item)
    directory = PREVIEWS if optimized else FILES
    stored = optimized.name if optimized else item["stored"]
    return send_from_directory(directory, stored, as_attachment=False, download_name=item["name"],
                               mimetype=mime, conditional=True, max_age=3600)


@app.get("/preview/<token>")
def preview_by_id(token):
    with db() as conn:
        item = conn.execute("SELECT * FROM files WHERE id = ?", (token,)).fetchone()
    if item is None:
        abort(404)
    return preview_response(item)


@app.get("/media/<token>")
def media(token):
    with db() as conn:
        item = conn.execute("SELECT * FROM files WHERE id = ?", (token,)).fetchone()
    if item is None:
        abort(404)
    _, mime = preview_type(item["name"])
    if mime is None:
        abort(404)
    return preview_response(item)


@app.get("/<path:requested_path>")
def named_preview(requested_path):
    parts = requested_path.split("/")
    if any(clean_name(part) != part for part in parts):
        abort(404)
    with db() as conn:
        if len(parts) == 1:
            root_matches = conn.execute("SELECT * FROM files WHERE name = ? AND folder_id IS NULL", (parts[0],)).fetchall()
            matches = root_matches or conn.execute("SELECT * FROM files WHERE name = ?", (parts[0],)).fetchall()
        else:
            parent_id = None
            for name in parts[:-1]:
                folder = conn.execute("SELECT id FROM folders WHERE parent_id IS ? AND name = ?", (parent_id, name)).fetchone()
                if folder is None:
                    abort(404)
                parent_id = folder["id"]
            matches = conn.execute("SELECT * FROM files WHERE folder_id = ? AND name = ?", (parent_id, parts[-1])).fetchall()
    if not matches:
        abort(404)
    if len(matches) > 1:
        return "More than one file has this name. Use its unique preview or download link.", 409
    return preview_response(matches[0])


@app.post("/delete/<token>")
def delete(token):
    if not logged_in():
        abort(403)
    with db() as conn:
        item = conn.execute("SELECT * FROM files WHERE id = ?", (token,)).fetchone()
        if item is None:
            abort(404)
        conn.execute("DELETE FROM files WHERE id = ?", (token,))
        conn.commit()
    (FILES / item["stored"]).unlink(missing_ok=True)
    local_path = LIBRARY / token / item["name"]
    local_path.unlink(missing_ok=True)
    if local_path.parent.is_dir() and not any(local_path.parent.iterdir()):
        local_path.parent.rmdir()
    (PREVIEWS / (item["stored"] + ".gif")).unlink(missing_ok=True)
    flash("File deleted. Its share link no longer works.")
    return redirect(folder_url(request.form.get("current_folder")))


@app.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))


@app.errorhandler(RequestEntityTooLarge)
def too_large(error):
    return "Upload too large. Limit: 512 MB per request.", 413


@app.after_request
def headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.path.startswith("/static/"):
        response.headers["Cache-Control"] = "public, max-age=86400"
    elif request.endpoint in ("preview_by_id", "named_preview", "media") and response.status_code in (200, 206) and response.mimetype != "text/html":
        response.headers["Cache-Control"] = "public, max-age=3600"
    else:
        response.headers["Cache-Control"] = "private, no-store, max-age=0"
    return response
