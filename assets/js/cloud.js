// Cloud sync: the last uploaded save is stored in Supabase Storage and loaded
// automatically when the page opens, on any device.
const SUPABASE_URL = "https://fjmimdmwdqbxvstwnxpy.supabase.co";
const SUPABASE_KEY = "sb_publishable_cHqz95EXvZSUaDGEyZDX-g_iZKvA74p";
const SAVE_BUCKET = "saves";
const SAVE_PATH = "latest.sl2";
const META_PATH = "meta.json";

const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
let cloudMeta = { slot: null };

function setCloudStatus(text, kind = "") {
  const el = document.getElementById("cloud_status");
  if (!el) return;
  el.textContent = text;
  el.className = "cloud-status" + (kind ? " " + kind : "");
}

function formatTime(d) {
  return new Date(d).toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

async function writeMeta() {
  const blob = new Blob([JSON.stringify(cloudMeta)], { type: "application/json" });
  await sb.storage.from(SAVE_BUCKET).upload(META_PATH, blob, { upsert: true, cacheControl: "0" });
}

// Called after the user picks a new save file
async function cloudSave(file) {
  if (!sb) return;
  setCloudStatus("Đang lưu save lên cloud…");
  const { error } = await sb.storage
    .from(SAVE_BUCKET)
    .upload(SAVE_PATH, file, { upsert: true, cacheControl: "0", contentType: "application/octet-stream" });
  if (error) {
    setCloudStatus("Không lưu được lên cloud: " + error.message, "error");
    return;
  }
  setCloudStatus("Đã lưu lên cloud lúc " + formatTime(Date.now()) + " — thiết bị khác mở trang là thấy.", "ok");
}

// Called when the user picks a character slot, so other devices open the same one
async function cloudSaveSlot(slotIndex) {
  if (!sb || String(cloudMeta.slot) === String(slotIndex)) return;
  cloudMeta.slot = Number(slotIndex);
  try {
    await writeMeta();
  } catch (e) {}
}

async function cloudLoad() {
  if (!sb) {
    setCloudStatus("Không kết nối được cloud.", "error");
    return;
  }
  setCloudStatus("Đang tải save từ cloud…");
  const bucket = sb.storage.from(SAVE_BUCKET);

  const [{ data: list }, { data: metaBlob }] = await Promise.all([
    bucket.list("", { search: SAVE_PATH }),
    bucket.download(META_PATH).catch(() => ({ data: null })),
  ]);
  const info = (list || []).find((f) => f.name === SAVE_PATH);
  if (!info) {
    setCloudStatus("Chưa có save trên cloud — chọn file để lưu.");
    return;
  }
  if (metaBlob) {
    try {
      cloudMeta = Object.assign(cloudMeta, JSON.parse(await metaBlob.text()));
    } catch (e) {}
  }

  const { data: blob, error } = await bucket.download(SAVE_PATH);
  if (error || !blob) {
    setCloudStatus("Không tải được save từ cloud.", "error");
    return;
  }
  const buffer = await blob.arrayBuffer();

  let slot = cloudMeta.slot;
  if (slot === null || slot === undefined) {
    try {
      const local = localStorage.getItem("er_last_slot");
      if (local !== null) slot = Number(local);
    } catch (e) {}
  }
  if (slot === null || slot === undefined || !getNames(buffer)[slot]) {
    slot = getNames(buffer).findIndex((n) => n !== "");
  }

  if (!loadSaveBuffer(buffer, slot >= 0 ? slot : null)) {
    setCloudStatus("Save trên cloud không hợp lệ.", "error");
    return;
  }
  setCloudStatus("Đang dùng save trên cloud (cập nhật " + formatTime(info.updated_at || info.created_at) + "). Chọn file mới để thay thế.", "ok");
  if (slot >= 0) calculate();
}

$(function () {
  cloudLoad().catch((e) => setCloudStatus("Lỗi tải cloud: " + e.message, "error"));
});
