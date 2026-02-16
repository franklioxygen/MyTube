import { logger } from "../utils/logger";
import * as storageService from "./storageService";
import { Settings } from "../types/settings";

interface TelegramStrings {
  taskSuccess: string;
  taskFailed: string;
  title: string;
  url: string;
  error: string;
  testSuccess: string;
}

const translations: Record<string, TelegramStrings> = {
  en: { taskSuccess: "Task Success", taskFailed: "Task Failed", title: "Title", url: "URL", error: "Error", testSuccess: "MyTube Telegram notification test successful!" },
  zh: { taskSuccess: "任务成功", taskFailed: "任务失败", title: "标题", url: "链接", error: "错误", testSuccess: "MyTube Telegram 通知测试成功！" },
  ja: { taskSuccess: "タスク成功", taskFailed: "タスク失敗", title: "タイトル", url: "URL", error: "エラー", testSuccess: "MyTube Telegram 通知テスト成功！" },
  ko: { taskSuccess: "작업 성공", taskFailed: "작업 실패", title: "제목", url: "URL", error: "오류", testSuccess: "MyTube Telegram 알림 테스트 성공!" },
  fr: { taskSuccess: "Tâche réussie", taskFailed: "Tâche échouée", title: "Titre", url: "URL", error: "Erreur", testSuccess: "Test de notification Telegram MyTube réussi !" },
  de: { taskSuccess: "Aufgabe erfolgreich", taskFailed: "Aufgabe fehlgeschlagen", title: "Titel", url: "URL", error: "Fehler", testSuccess: "MyTube Telegram-Benachrichtigungstest erfolgreich!" },
  es: { taskSuccess: "Tarea exitosa", taskFailed: "Tarea fallida", title: "Título", url: "URL", error: "Error", testSuccess: "¡Prueba de notificación de Telegram de MyTube exitosa!" },
  pt: { taskSuccess: "Tarefa concluída", taskFailed: "Tarefa falhou", title: "Título", url: "URL", error: "Erro", testSuccess: "Teste de notificação Telegram do MyTube bem-sucedido!" },
  ru: { taskSuccess: "Задача выполнена", taskFailed: "Задача не выполнена", title: "Название", url: "URL", error: "Ошибка", testSuccess: "Тест уведомлений Telegram MyTube успешен!" },
  ar: { taskSuccess: "نجحت المهمة", taskFailed: "فشلت المهمة", title: "العنوان", url: "الرابط", error: "خطأ", testSuccess: "اختبار إشعارات تيليجرام MyTube ناجح!" },
};

function getStrings(lang?: string): TelegramStrings {
  return translations[lang || "en"] || translations.en;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendMessage(botToken: string, chatId: string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as any).description || `Telegram API error: ${response.status}`);
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

      const s = getStrings(settings.language);
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
    } catch (error: any) {
      logger.error(`[TelegramService] Failed to send notification: ${error.message}`);
    }
  }

  static async sendTestMessage(botToken: string, chatId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const settings = storageService.getSettings() as Settings;
      const s = getStrings(settings.language);
      await sendMessage(botToken, chatId, `\u2705 ${s.testSuccess}`);
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }
}
