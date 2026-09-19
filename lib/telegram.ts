// lib/telegram.ts
// Telegram Bot API integration for file upload and retrieval
// Only uses native fetch (no external dependencies)

// Validate required environment variables at module load time
if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN belum diset di environment variables");
}
if (!process.env.TELEGRAM_STORAGE_CHAT_ID) {
  throw new Error("TELEGRAM_STORAGE_CHAT_ID belum diset di environment variables");
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_STORAGE_CHAT_ID = process.env.TELEGRAM_STORAGE_CHAT_ID!;
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const TELEGRAM_FILE_BASE = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}`;

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface SendPhotoResult {
  photo: Array<{
    file_id: string;
    file_size: number;
    width: number;
    height: number;
  }>;
}

interface SendDocumentResult {
  document: {
    file_id: string;
    file_name: string;
    file_size: number;
  };
}

interface GetFileResult {
  file_path: string;
  file_size: number;
  file_id: string;
}

/**
 * Upload file to Telegram storage chat
 * Returns the file_id for later retrieval
 */
export async function uploadToTelegram(
  fileBuffer: Buffer,
  filename: string,
  options?: { asDocument?: boolean }
): Promise<{ fileId: string }> {
  const formData = new FormData();
  formData.append("chat_id", TELEGRAM_STORAGE_CHAT_ID);

  const endpoint = options?.asDocument
    ? `${TELEGRAM_API_BASE}/sendDocument`
    : `${TELEGRAM_API_BASE}/sendPhoto`;

  // Attach file - convert Buffer to Uint8Array for Blob compatibility
  const blob = new Blob([new Uint8Array(fileBuffer)]);
  formData.append(options?.asDocument ? "document" : "photo", blob, filename);

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });

  const data: TelegramResponse<SendPhotoResult | SendDocumentResult> = await response.json();

  if (!data.ok) {
    throw new Error(`Telegram upload failed: ${data.description ?? "Unknown error"}`);
  }

  let fileId: string;

  if (options?.asDocument) {
    // sendDocument returns document.file_id
    const docResult = data.result as SendDocumentResult;
    fileId = docResult.document.file_id;
  } else {
    // sendPhoto returns array of photo sizes, pick the LAST one (largest resolution)
    const photoResult = data.result as SendPhotoResult;
    if (!photoResult.photo || photoResult.photo.length === 0) {
      throw new Error("Telegram response: no photo sizes returned");
    }
    const lastPhoto = photoResult.photo[photoResult.photo.length - 1];
    if (!lastPhoto) {
      throw new Error("Telegram response: last photo size is undefined");
    }
    fileId = lastPhoto.file_id;
  }

  return { fileId };
}

/**
 * Get temporary URL for a Telegram file
 * 
 * URL ini bersifat SEMENTARA, jangan pernah disimpan ke database —
 * panggil fungsi ini ulang setiap kali gambar perlu ditampilkan.
 */
export async function getTelegramFileUrl(fileId: string): Promise<string> {
  const response = await fetch(`${TELEGRAM_API_BASE}/getFile?file_id=${fileId}`);
  const data: TelegramResponse<GetFileResult> = await response.json();

  if (!data.ok || !data.result) {
    throw new Error(`Telegram getFile failed: ${data.description ?? "Unknown error"}`);
  }

  // Construct the full file URL
  return `${TELEGRAM_FILE_BASE}/${data.result.file_path}`;
}