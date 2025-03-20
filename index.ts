import { Bot, InputFile } from "grammy";
import OpenAI from "openai";
import { join } from "path";
import { createReadStream } from "fs";
import fs from "fs";
import { pipeline } from "stream";
import { promisify } from "util";

const bot = new Bot(process.env.TELEGRAMM!);
const oai = new OpenAI({ apiKey: process.env.OPENAI! });

const streamPipeline = promisify(pipeline);
const rand = () => Math.random().toString(16).slice(2, 8) + ".ogg";
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

bot.on("msg:text", async (ctx) => {
  const input = ctx.update.message?.text;
  if (!input) return;

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
});

bot.on(":voice", async (ctx) => {
  try {
    const fileId = ctx.message?.voice.file_id;
    if (!fileId) return;

    const file = await ctx.api.getFile(fileId); // Получаем file_path
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAMM!}/${file.file_path}`;

    const response = await fetch(fileUrl);
    if (!response.ok || !response.body) {
      return ctx.reply("Ошибка загрузки файла.");
    }

    const filePath = voicePath(fileId);
    // @ts-ignore
    await streamPipeline(response.body, fs.createWriteStream(filePath));

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

bot.start({
  onStart: () => console.log("Bot runned..."),
});
