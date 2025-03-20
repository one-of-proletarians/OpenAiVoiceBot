import { createReadStream, createWriteStream } from "fs";
import { Bot, Context, InputFile } from "grammy";
import OpenAI from "openai";
import { join } from "path";
import { pipeline } from "stream";
import { promisify } from "util";

const bot = new Bot(process.env.TELEGRAMM!);
const oai = new OpenAI({ apiKey: process.env.OPENAI! });

const streamPipeline = promisify(pipeline);
const userIds = process.env.USERS!.split(",").map(Number);
const voicePath = (name: string) => join(__dirname, "voices", name + ".ogg");

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
    const res = await oai.audio.speech.create({
      input,
      voice: "shimmer",
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
