// More looks and presets (web, 2026-10-18): popular editing styles — «clean girl», glass skin,
// golden hour, film, editorial, moody, pastel, retro, noir … — as recipes over the app's own
// sliders. A look sets the whole edit (retouch + make-up + colour) and has a strength slider; a preset
// is lighter (mostly colour and light). Filters are named, their numbers are looked up here, so the
// list of filters can grow without breaking these.
import { FILTER_NAMES } from "../ops/filters.js";
import { LIP_COLORS, BLUSH_COLORS } from "../ops/makeup.js";

const F = (name, amount = 100) => {
  const style = FILTER_NAMES.indexOf(name);
  if (style < 0) throw new Error(`no filter ${name}`);
  return { style, amount };
};
const LIP = (name) => Object.keys(LIP_COLORS).indexOf(name);
const BLUSH = (name) => Object.keys(BLUSH_COLORS).indexOf(name);

export const MORE_LOOKS = {
  "Clean girl": {
    skin: { smooth: 45, blemish: 90 }, skin_tone: { even: 40, redness: 40 }, face_light: { matte: 50 },
    teeth_eyes: { sclera: 30 }, makeup: { brows: 40, blush: 25, blush_color: BLUSH("Персиковые"), lips: 25, lip_color: LIP("Нюд") },
    filter: F("Чистая кожа", 70),
  },
  "Стеклянная кожа": {
    skin: { smooth: 60, texture: 80, blemish: 90 }, skin_tone: { even: 50 }, face_light: { fill: 40, soften: 30 },
    teeth_eyes: { sclera: 30, iris: 30 }, filter: F("Глянец", 40),
  },
  "Свежесть": {
    skin: { smooth: 35, blemish: 85 }, skin_tone: { redness: 40 }, face_detail: { circles: 40 }, face_light: { matte: 35 },
    teeth_eyes: { sclera: 25 },
  },
  "Золотой час": {
    skin: { smooth: 40, blemish: 80 }, makeup: { blush: 30, blush_color: BLUSH("Персиковые"), contour: 30 },
    face_light: { fill: 30 }, filter: F("Золотой час", 80),
  },
  "Плёнка Портра": {
    skin: { smooth: 35, blemish: 70 }, skin_natural: { texture: 60 }, filter: F("Портра", 90), grain: { amount: 25 },
  },
  "Журнал": {
    skin: { smooth: 55, blemish: 90 }, face_detail: { circles: 40, folds: 30 },
    makeup: { contour: 60, brows: 60, eyeliner: 50, lips: 40, lip_color: LIP("Ягодный") }, face_shape: { slim: 20, jaw: 15 },
    sharpen: { clarity: 25 }, filter: F("Кларендон", 50),
  },
  "Муди": {
    skin: { smooth: 45, blemish: 80 }, makeup: { eyeliner: 40, contour: 30 }, filter: F("Муди", 85), grain: { amount: 20 },
  },
  "Пастель": {
    skin: { smooth: 50, blemish: 85 }, makeup: { blush: 35, blush_color: BLUSH("Розовые"), lips: 35, lip_color: LIP("Розовый") },
    filter: F("Пастель", 75),
  },
  "Лето": {
    skin: { smooth: 40, blemish: 80 }, skin_tone: { tan: 30 }, color: { vibrance: 15 }, filter: F("Кодак Голд", 70),
  },
  "Кинокадр": {
    skin: { smooth: 45, blemish: 80 }, makeup: { contour: 40 }, filter: F("Тил и оранж", 80), grain: { amount: 15 },
  },
  "Ретро": {
    skin: { smooth: 40, blemish: 70 }, filter: F("Ретро 70-х", 85), grain: { amount: 40, size: 40 },
  },
  "Нуар": {
    skin: { smooth: 45, blemish: 80 }, makeup: { eyeliner: 40 }, filter: F("Нуар", 100), grain: { amount: 30 },
  },
};

export const MORE_PRESETS = {
  "Мягкий свет": { face_light: { soften: 50, fill: 30 }, light: { shadows: 15 } },
  "Яркий день": { light: { shadows: 10 }, filter: F("Экта", 60) },
  "Фуджи": { skin: { smooth: 30, blemish: 70 }, filter: F("Фуджи", 90), grain: { amount: 15 } },
  "Синестилл": { filter: F("Синестилл", 90), grain: { amount: 25 } },
  "Матовый": { filter: F("Матовый", 90) },
  "Розовый": { filter: F("Розовый", 80) },
  "Осень": { filter: F("Осень", 85) },
  "Зима": { filter: F("Зима", 85) },
  "Ч/Б мягкий": { filter: F("Ч/Б мягкий", 100), grain: { amount: 20 } },
  "Сепия": { filter: F("Сепия", 100), grain: { amount: 25 } },
};
