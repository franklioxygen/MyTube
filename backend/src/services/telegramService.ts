import { logger } from "../utils/logger";
import * as storageService from "./storageService";
import { Settings } from "../types/settings";
import { buildAllowlistedHttpUrl } from "../utils/security";

interface TelegramStrings {
  taskSuccess: string;
  taskFailed: string;
  title: string;
  url: string;
  error: string;
  testSuccess: string;
  queued: string;
  skipped: string;
  failed: string;
  taskId: string;
  unknownError: string;
  downloadRequestNoResponse: string;
}

const translations: Record<string, TelegramStrings> = {
  en: { taskSuccess: "Task Success", taskFailed: "Task Failed", title: "Title", url: "URL", error: "Error", testSuccess: "MyTube Telegram notification test successful!", queued: "Queued", skipped: "Skipped", failed: "Failed", taskId: "Task ID", unknownError: "Unknown error", downloadRequestNoResponse: "Download request did not return a response" },
  zh: { taskSuccess: "任务成功", taskFailed: "任务失败", title: "标题", url: "链接", error: "错误", testSuccess: "MyTube Telegram 通知测试成功！", queued: "已加入队列", skipped: "已跳过", failed: "失败", taskId: "任务 ID", unknownError: "未知错误", downloadRequestNoResponse: "下载请求没有返回响应" },
  ja: { taskSuccess: "タスク成功", taskFailed: "タスク失敗", title: "タイトル", url: "URL", error: "エラー", testSuccess: "MyTube Telegram 通知テスト成功！", queued: "キューに追加済み", skipped: "スキップ済み", failed: "失敗", taskId: "タスク ID", unknownError: "不明なエラー", downloadRequestNoResponse: "ダウンロードリクエストが応答を返しませんでした" },
  ko: { taskSuccess: "작업 성공", taskFailed: "작업 실패", title: "제목", url: "URL", error: "오류", testSuccess: "MyTube Telegram 알림 테스트 성공!", queued: "대기열에 추가됨", skipped: "건너뜀", failed: "실패", taskId: "작업 ID", unknownError: "알 수 없는 오류", downloadRequestNoResponse: "다운로드 요청이 응답을 반환하지 않았습니다" },
  fr: { taskSuccess: "Tâche réussie", taskFailed: "Tâche échouée", title: "Titre", url: "URL", error: "Erreur", testSuccess: "Test de notification Telegram MyTube réussi !", queued: "Ajouté à la file", skipped: "Ignoré", failed: "Échec", taskId: "ID de tâche", unknownError: "Erreur inconnue", downloadRequestNoResponse: "La requête de téléchargement n'a renvoyé aucune réponse" },
  de: { taskSuccess: "Aufgabe erfolgreich", taskFailed: "Aufgabe fehlgeschlagen", title: "Titel", url: "URL", error: "Fehler", testSuccess: "MyTube Telegram-Benachrichtigungstest erfolgreich!", queued: "In Warteschlange", skipped: "Übersprungen", failed: "Fehlgeschlagen", taskId: "Aufgaben-ID", unknownError: "Unbekannter Fehler", downloadRequestNoResponse: "Die Download-Anfrage hat keine Antwort zurückgegeben" },
  es: { taskSuccess: "Tarea exitosa", taskFailed: "Tarea fallida", title: "Título", url: "URL", error: "Error", testSuccess: "¡Prueba de notificación de Telegram de MyTube exitosa!", queued: "En cola", skipped: "Omitido", failed: "Error", taskId: "ID de tarea", unknownError: "Error desconocido", downloadRequestNoResponse: "La solicitud de descarga no devolvió una respuesta" },
  pt: { taskSuccess: "Tarefa concluída", taskFailed: "Tarefa falhou", title: "Título", url: "URL", error: "Erro", testSuccess: "Teste de notificação Telegram do MyTube bem-sucedido!", queued: "Na fila", skipped: "Ignorado", failed: "Falhou", taskId: "ID da tarefa", unknownError: "Erro desconhecido", downloadRequestNoResponse: "A solicitação de download não retornou uma resposta" },
  ru: { taskSuccess: "Задача выполнена", taskFailed: "Задача не выполнена", title: "Название", url: "URL", error: "Ошибка", testSuccess: "Тест уведомлений Telegram MyTube успешен!", queued: "Добавлено в очередь", skipped: "Пропущено", failed: "Ошибка", taskId: "ID задачи", unknownError: "Неизвестная ошибка", downloadRequestNoResponse: "Запрос на загрузку не вернул ответ" },
  ar: { taskSuccess: "نجحت المهمة", taskFailed: "فشلت المهمة", title: "العنوان", url: "الرابط", error: "خطأ", testSuccess: "اختبار إشعارات تيليجرام MyTube ناجح!", queued: "تمت الإضافة إلى قائمة الانتظار", skipped: "تم التخطي", failed: "فشل", taskId: "معرّف المهمة", unknownError: "خطأ غير معروف", downloadRequestNoResponse: "لم يُرجع طلب التنزيل أي استجابة" },
};

export function getTelegramStrings(lang?: string): TelegramStrings {
  switch (lang) {
    case "zh":
      return translations.zh;
    case "ja":
      return translations.ja;
    case "ko":
      return translations.ko;
    case "fr":
      return translations.fr;
    case "de":
      return translations.de;
    case "es":
      return translations.es;
    case "pt":
      return translations.pt;
    case "ru":
      return translations.ru;
    case "ar":
      return translations.ar;
    case "en":
    default:
      return translations.en;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const TELEGRAM_BOT_TOKEN_RE = /^\d+:[A-Za-z0-9_-]+$/;
const TELEGRAM_CHAT_ID_RE = /^-?\d+$/;
const TELEGRAM_ALLOWED_HOSTS = ["api.telegram.org"];

async function parseTelegramErrorBody(
  response: Response,
): Promise<{ description?: string }> {
  try {
    return (await response.json()) as { description?: string };
  } catch (error) {
    void error;
    return {};
  }
}

async function sendMessage(botToken: string, chatId: string, text: string): Promise<void> {
  try {
    if (!TELEGRAM_BOT_TOKEN_RE.test(botToken)) {
      throw new Error("Invalid Telegram bot token format");
    }
    if (!TELEGRAM_CHAT_ID_RE.test(chatId)) {
      throw new Error("Invalid Telegram chat ID format");
    }
    const url = buildAllowlistedHttpUrl(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      TELEGRAM_ALLOWED_HOSTS
    );
    const response = await fetch(url, { // nosemgrep
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });

    if (!response.ok) {
      const body = await parseTelegramErrorBody(response);
      throw new Error((body as { description?: string }).description || `Telegram API error: ${response.status}`);
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export class TelegramService {
  static async notifyTaskComplete(context: {
    taskTitle: string;
    status: "success" | "fail";
    sourceUrl?: string;
    error?: string;
  }): Promise<void> {
    try {
      const settings = storageService.getSettings() as Settings;

      if (!settings.telegramEnabled || !settings.telegramBotToken || !settings.telegramChatId) {
        return;
      }

      if (context.status === "success" && settings.telegramNotifyOnSuccess === false) return;
      if (context.status === "fail" && settings.telegramNotifyOnFail === false) return;

      const s = getTelegramStrings(settings.language);
      const emoji = context.status === "success" ? "\u2705" : "\u274c";
      const statusLabel = context.status === "success" ? s.taskSuccess : s.taskFailed;
      let text = `${emoji} <b>${statusLabel}</b>\n<b>${s.title}:</b> ${escapeHtml(context.taskTitle)}`;
      if (context.sourceUrl) {
        text += `\n<b>${s.url}:</b> ${escapeHtml(context.sourceUrl)}`;
      }
      if (context.error) {
        text += `\n<b>${s.error}:</b> ${escapeHtml(context.error)}`;
      }

      await sendMessage(settings.telegramBotToken, settings.telegramChatId, text);
    } catch (error: unknown) {
      logger.error(`[TelegramService] Failed to send notification: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Send a one-off plain text alert (used by the statistics alert dispatcher).
  static async sendAlert(text: string): Promise<boolean> {
    try {
      const settings = storageService.getSettings() as Settings;
      if (!settings.telegramEnabled || !settings.telegramBotToken || !settings.telegramChatId) {
        return false;
      }
      await sendMessage(settings.telegramBotToken, settings.telegramChatId, escapeHtml(text));
      return true;
    } catch (error: unknown) {
      logger.error(
        `[TelegramService] Failed to send alert: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  static async sendConfiguredPlainMessage(text: string): Promise<boolean> {
    try {
      const settings = storageService.getSettings() as Settings;
      if (!settings.telegramEnabled || !settings.telegramBotToken || !settings.telegramChatId) {
        return false;
      }

      await sendMessage(settings.telegramBotToken, settings.telegramChatId, escapeHtml(text));
      return true;
    } catch (error: unknown) {
      logger.error(
        `[TelegramService] Failed to send message: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  static async sendTestMessage(botToken: string, chatId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const settings = storageService.getSettings() as Settings;
      const s = getTelegramStrings(settings.language);
      await sendMessage(botToken, chatId, `\u2705 ${s.testSuccess}`);
      return { ok: true };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
