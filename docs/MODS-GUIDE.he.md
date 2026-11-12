<div dir="rtl">

# מודים ב־Claude Code: מה זה, איך מתקינים, ואיך בונים אחד

מדריך קצר ומעשי. העובדות כאן לקוחות מהמקורות הרשמיים של Anthropic, שמופיעים בסוף, ומהניסיון בבניית המוד [task-board](../README.md).

---

## 1. מה זה מוד

מוד הוא תוסף קטן ל־Claude Code שמשנה איך הוא **נראה** ואיך הוא **מתנהג**. הוא כתוב ב־TypeScript או ב־JavaScript, והוא רץ בתוך Claude Code עצמו.

הרעיון פשוט. בכל פעם ש־Claude Code עושה משהו, הוא "מכריז" על אירוע: Claude קורא לכלי, אתם שולחים הודעה, או שחלק מהממשק מצויר על המסך. מוד הוא פונקציה שנרשמת לאירוע כזה. היא יכולה רק להסתכל עליו, לשנות אותו, או לקחת אותו לגמרי לידיים שלה.

Anthropic השיקה את המודים ב־1 באוקטובר 2026.

## 2. מה מוד יכול לעשות

- **לצייר ממשק משלו:** חלונית בצד השיחה, או פס מעל שורת ההקלדה, עם כפתורים, לשוניות ושדות טקסט. task-board הוא פס כזה.
- **לשנות את הממשק של Claude Code עצמו:** להחליף או לעצב מחדש חלקים שהוא מצייר, כמו השורה של קריאה לכלי, הספינר או חלון השאלות.
- **להתערב בקריאה לכלי:** לחסום אותה, לשכתב אותה או לנסות אותה שוב. לאשר או לדחות בקשת הרשאה. להסתיר סודות מפלט של כלי לפני ש־Claude קורא אותו.
- **לשכתב הודעה** לפני שהיא מגיעה למודל.
- **להוסיף פקודה:** `/משהו` שמריצה את הקוד שלכם מיד, בלי לחכות ל־Claude.
- **לשתף מידע בין חלקים:** חלק אחד סופר קריאות לכלים, וחלק אחר מציג את הספירה ליד הספינר.

## 3. מוד, Skill, Hook או MCP?

| הכלי | מה הוא עושה | מתי לבחור בו |
|---|---|---|
| **Skill** | מלמד את Claude **איך** לעשות משימה: הוראות, תבניות, סקריפטים | כשאתם רוצים ש־Claude יעבוד אחרת |
| **Hook (בקובץ הגדרות)** | מריץ פקודת shell, בקשת HTTP או prompt כשאירוע קורה | לפעולה פשוטה סביב אירוע, בלי ממשק |
| **שרת MCP** | נותן ל־Claude כלים חדשים ומקורות מידע (Gmail, מסד נתונים) | כשצריך לחבר את Claude למערכת חיצונית |
| **מוד** | משנה את Claude Code **עצמו**: ממשק, התנהגות, פקודות | כשאתם רוצים לראות או לשלוט במשהו ש־Claude Code לא נותן |

ההבדל המרכזי בין מוד ל־Hook: Hook רץ כתהליך נפרד. מוד רץ בתוך Claude Code, ולכן הוא יכול לצייר ממשק, לשכתב אירועים ולהחליף פיצ'רים קיימים.

## 4. איפה זה עובד

- ב־Claude Code בטרמינל (CLI), וגם בלשונית Code של אפליקציית Claude לדסקטופ: שם החלקים הגרפיים מצוירים.
- בתוסף ל־VS Code ובהרצות כמו `claude -p`, ה־hooks של המוד ממשיכים לפעול, רק בלי החלק הגרפי.
- חלק מהפיצ'רים המובנים של Claude Code כבר בנויים בעצמם כמודים, למשל `/diff`. אפשר לכבות אותם או להחליף אותם בגרסה שלכם.

## 5. בטיחות: לפני שמתקינים

**מודים לא רצים בארגז חול.** למוד יש את אותה גישה למחשב שיש ל־Claude Code. לכן:

- התקינו רק ממקור שאתם סומכים עליו.
- קראו את הקוד לפני ההתקנה, או בקשו מ־Claude לעבור עליו ולהסביר מה הוא עושה.
- בתוכניות Team ו־Enterprise, מנהל הארגון קובע אילו מקורות מותרים. מוד מובנה בשם `sec-default` נטען ראשון ומונע ממודים אחרים לעשות דברים מסוכנים, כמו לעקוף כללי הרשאות.

## 6. איך מתקינים מוד

מודים מופצים בתוך **plugins**, ולכן מתקינים אותם כמו כל plugin.

**בטרמינל**, בתוך סשן של Claude Code:

<div dir="ltr">

```
/plugin install <שם-המוד> --marketplace <owner>/<repo>
```

</div>

עונים `y` כדי להוסיף את ה־marketplace, ואז Enter. לדוגמה, task-board:

<div dir="ltr">

```
/plugin install task-board --marketplace yokxx/claude-task-board
```

</div>

**מה־shell** (בלי לפתוח סשן):

<div dir="ltr">

```bash
claude plugin install task-board --marketplace yokxx/claude-task-board
```

</div>

**באפליקציית הדסקטופ**, שבה `/plugin` לא רץ: לוחצים על **+** ליד תיבת ההקלדה, ואז **Plugins**, ואז **Add marketplace**, מזינים את `owner/repo`, ובסוף **Add plugin**.

אפשר גם לחפש מודים מוכנים בספריית ה־plugins של Claude, או להקליד `/plugin` בטרמינל ולדפדף.

**כדי לראות מה מותקן:** `claude plugin list`. **כדי להסיר:** `claude plugin uninstall <שם-המוד>`.

## 7. איך בונים מוד: הדרך הקלה

לא צריך לדעת TypeScript. Claude Code יודע לכתוב מודים בעצמו: הוא כותב את הקוד, מתקין אותו, וטוען אותו מחדש תוך כדי הסשן.

1. פותחים שיחה חדשה ב־Claude Code.
2. מבקשים, למשל: "תיצור לי מוד חדש שמראה מעל שורת ההקלדה כמה זמן לקח התור האחרון וכמה כלים Claude הפעיל".
3. מסבירים את המטרה: מה אתם רוצים לראות, איפה, ומתי. ככל שהתיאור מדויק יותר, התוצאה טובה יותר.
4. בפעם הראשונה ש־Claude כותב מוד בסשן, Claude Code שואל אם להפעיל את המודים שהוא כותב. עונים **Turn them on**.
5. המוד נטען כשהתור של Claude נגמר. כל שינוי נוסף נטען מחדש בסוף התור שבו הוא נעשה.
6. מסתכלים על התוצאה ומבקשים תיקונים: "הפס צפוף מדי", "תוסיף כפתור הסתרה", "תכתוב את זה בעברית".

**טיפ מהניסיון:** כמעט תמיד צריך כמה סבבי תיקון. זה בסדר. תתארו מה מפריע לכם במילים פשוטות, ו־Claude יתקן.

## 8. איך בנוי מוד מבפנים

מוד מינימלי הוא תיקייה עם שלושה קבצים:

<div dir="ltr">

```
env-guard/
├── .claude-plugin/plugin.json
└── hooks/
    ├── hooks.json
    └── register.ts
```

</div>

**`.claude-plugin/plugin.json`**: השם והתיאור של המוד.

<div dir="ltr">

```json
{ "name": "env-guard", "version": "0.1.0", "description": "Stops Claude from editing .env files" }
```

</div>

**`hooks/hooks.json`**: איזה קובץ קוד לטעון.

<div dir="ltr">

```json
{ "modules": ["./register.ts"] }
```

</div>

**`hooks/register.ts`**: הקוד עצמו. המוד הזה חוסם עריכה של קבצי `.env`:

<div dir="ltr">

```ts
import type { Register } from 'claude-code'

const PROTECTED = /(^|\/)\.env(\.|$)/

export const register: Register = on => {
  on('tool.call', { tool: 'Edit' }, ($, e, next) =>
    PROTECTED.test(e.file_path)
      ? { deny: `${$.plugin.name}: ${e.file_path} is protected.` }
      : next(e),
  )
}
```

</div>

מה קורה כאן:

- `on(אירוע, סינון, פונקציה)` נרשם לאירוע. כאן: כל קריאה לכלי `Edit`.
- `e` הוא תוכן האירוע. כאן: הקובץ ש־Claude רוצה לערוך.
- `next(e)` אומר "תמשיך כרגיל". מי שמחזיר משהו אחר, כמו `{ deny }`, עוצר את הפעולה.
- `$` הוא הממשק לכל השאר: לצייר (`$.ui`), לשמור מצב (`$.state`), לקרוא למודל (`$.model`), להוסיף פקודה (`$.command`).

**כדי לצייר פס מעל שורת ההקלדה**, נרשמים לאירוע הציור של הפס ומחזירים רכיבים:

<div dir="ltr">

```tsx
on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
  const { Box, Text } = $.ui.resolve(e)
  return <Box><Text>Hello from my mod</Text></Box>
})
```

</div>

`$.ui.resolve(e)` מחזיר את הרכיבים של המשטח שמצייר עכשיו: טרמינל, דסקטופ, VS Code או מובייל. כך אותו מוד עובד בכולם.

## 9. פיתוח ובדיקה

<div dir="ltr">

```bash
claude --plugin-dir ./env-guard     # run a session with the mod loaded from its folder
claude plugin validate ./env-guard  # check the manifest and the code the way the engine will
claude plugin test ./env-guard      # run the mod's *.test.ts files
```

</div>

## 10. איך משתפים מוד

הדרך הפשוטה היא מאגר ב־GitHub:

1. מוסיפים לתיקיית המוד את הקובץ `.claude-plugin/marketplace.json`:

<div dir="ltr">

```json
{
  "name": "my-mods",
  "owner": { "name": "Your Name" },
  "plugins": [{ "name": "env-guard", "source": "./" }]
}
```

</div>

2. **לפני שמעלים:** בודקים שאין בקבצים מפתחות API, טוקנים, כתובות פנימיות או מידע של אחרים. Claude Code יכול לסרוק את התיקייה בשבילכם.
3. מעלים את התיקייה כמאגר ציבורי ב־GitHub.
4. כל אחד יכול להתקין עם שורה אחת: `/plugin install env-guard --marketplace <owner>/<repo>`.

## 11. דוגמה מלאה

[task-board](../README.md) הוא מוד אמיתי: פס עם אחוז התקדמות, שלבים, הסבר בעברית לכל פעולה, וחלונית לסוכני משנה. הקוד כולו ב־[`hooks/`](../hooks), כולל בדיקות.

---

## מקורות

- [Customize Claude Code with mods](https://claude.com/blog/claude-code-mods), הבלוג של Claude, ‏1 באוקטובר 2026
- [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview), התיעוד הרשמי של Claude Code

</div>
