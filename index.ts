import { Database } from "bun:sqlite";
import { createReadStream, createWriteStream, readFileSync } from "fs";
import {
  Bot,
  Context,
  InlineKeyboard,
  InputFile,
  session,
  type SessionFlavor,
} from "grammy";
import OpenAI from "openai";
import type { SpeechCreateParams } from "openai/resources/audio/speech.mjs";
import { join } from "path";
import { pipeline } from "stream";
import { promisify } from "util";

interface SessionData {
  voiceMessages: number[];
}

// Создаём кастомный контекст с сессией
type MyContext = Context & SessionFlavor<SessionData>;

const bot = new Bot<MyContext>(process.env.TELEGRAMM!);
const oai = new OpenAI({ apiKey: process.env.OPENAI! });

const streamPipeline = promisify(pipeline);
const userIds = process.env.USERS!.split(",").map(Number);
const voicePath = (name: string) => join(__dirname, "voices", name + ".ogg");
const voices = [
  "shimmer",
  "sage",
  "onyx",
  "nova",
  "fable",
  "echo",
  "coral",
  "alloy",
];

const db = new Database("SQLite.db");
db.query(
  `
  CREATE TABLE IF NOT EXISTS users (
    userid INTEGER PRIMARY KEY AUTOINCREMENT,
    voice TEXT NOT NULL
  )
`,
).run();

await bot.api.setMyCommands([
  { command: "voice", description: "Выбор голоса" },
]);

const initialSession = () => ({ voiceMessages: [] as number[] });
bot.use(session({ initial: initialSession }));

bot.use((ctx, next) => {
  const uid = ctx.from?.id;
  if (uid && userIds.includes(uid)) next();
  else ctx.reply("🤔");
});

bot.command("start", async (ctx) => {
  const uid = ctx.from?.id;
  if (uid && userIds.includes(uid)) {
    ctx.reply("Добро пожаловать !!!");
    ctx.reply("😉");
  } else {
    ctx.reply("Я тебя не знаю.");
    ctx.reply("🤔");
  }
});

bot.command("voice", async (ctx) => {
  const id = ctx.update.message?.from.id;
  const voice = getUserVoice(id);

  if (ctx.message?.message_id)
    ctx.session.voiceMessages.push(ctx.message?.message_id);

  const keyboard = InlineKeyboard.from([
    voices.map((voice, index) => InlineKeyboard.text(` ${index + 1} `, voice)),
  ]);

  for (const [index, v] of voices.entries()) {
    const res = await ctx.replyWithVoice(
      new InputFile(
        readFileSync(join(__dirname, "voice-examples", `${v}.ogg`)),
      ),
      {
        caption: `${index + 1} ) ${v}`,
        disable_notification: true,
      },
    );

    ctx.session.voiceMessages.push(res.message_id);
  }

  await ctx.reply(`Выбери голос\nCейчас выбран: <b>${voice}</b>`, {
    reply_markup: keyboard,
    parse_mode: "HTML",
    disable_notification: true,
  });
});

bot.on("callback_query:data", async (ctx) => {
  const voice = ctx.callbackQuery.data;
  const uid = ctx.update.callback_query.from.id;

  await ctx.answerCallbackQuery();
  ctx.editMessageText(`Голос изменен на: <b>${voice}</b>`, {
    parse_mode: "HTML",
  });
  if (ctx.session.voiceMessages.length)
    await ctx.deleteMessages(ctx.session.voiceMessages);

  const insert = db.prepare(`
      INSERT OR REPLACE INTO users (userid, voice)
      VALUES ($userid, $voice)
    `);

  try {
    insert.run({
      $userid: uid,
      $voice: voice,
    });
  } catch (e) {
    console.log(e);
  }
});

bot.on(":voice", async (ctx) => {
  try {
    const fileId = ctx.message?.voice.file_id;
    if (!fileId) return;

    const response = await fetchFile(ctx, fileId);
    const filePath = voicePath(fileId);
    // @ts-ignore
    await streamPipeline(response.body, createWriteStream(filePath));

    const text = await oai.audio.transcriptions.create({
      model: "whisper-1",
      response_format: "text",
      file: createReadStream(filePath),
    });

    ctx.reply(text, {
      reply_to_message_id: ctx.update.message?.message_id,
    });
  } catch (err) {
    console.error("Ошибка при загрузке файла:", err);
    ctx.reply("Ошибка при сохранении файла.");
  }
});

bot.on("msg:file", async (ctx) => {
  const fileId = ctx.message?.document?.file_id;
  const mime_type = ctx.update.message?.document?.mime_type;
  if (!fileId || !mime_type) return;

  if (mime_type !== "text/plain") {
    return ctx.reply("Только текстовые файлы.");
  }

  try {
    const response = await fetchFile(ctx, fileId);
    const buffer = await response!.arrayBuffer();
    const input = Buffer.from(buffer).toString("utf-8");

    replyVoice(ctx, input);
  } catch (error) {
    ctx.reply("Ошибка сохранения файла.");
  }
});

bot.on("msg:text", async (ctx) => {
  const input = ctx.update.message?.text;
  if (!input) return;

  replyVoice(ctx, input);
});

bot.start({
  onStart: () => console.log("Bot runned..."),
});

async function replyVoice(ctx: Context, input: string) {
  try {
    const id = ctx.update.message?.from.id;
    const voice = getUserVoice(id);

    const res = await oai.audio.speech.create({
      input,
      voice,
      model: "tts-1-hd",
      response_format: "opus",
    });
    ctx.replyWithVoice(new InputFile(Buffer.from(await res.arrayBuffer())), {
      reply_to_message_id: ctx.update.message?.message_id,
    });
  } catch (e) {
    console.log(e);
  }
}

async function fetchFile(
  ctx: Context,
  fileId: string,
): Promise<Response | undefined> {
  const file = await ctx.api.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAMM!}/${file.file_path}`;

  const response = await fetch(fileUrl);
  if (response.ok || response.body) return response;
}

function getUserVoice(id: number | undefined) {
  const { voice } = db
    .query(`SELECT voice FROM users WHERE userid = ?`)
    .get(id ?? 0) as {
    voice: SpeechCreateParams["voice"] | null;
  };

  return voice ?? "shimmer";
}
