using System;
using System.Reflection;
using System.Text;

// «Тапёр: заказ», шаг 1 — проверки и сборка адреса в аргумент tpUrl.
// Дальше шаг Fetch URL (%tpUrl%, заголовок X-Tapyor-Key = ~tapyorKey~, Parse JSON, res),
// потом шаг «ответ» (11-chat-reply.cs).
public class CPHInline
{
    public bool Execute()
    {
        string userId = ArgStr("userId");
        string user = ArgStr("user");
        if (user.Length == 0) user = ArgStr("userName");
        string raw = ArgStr("rawInput");
        string msgId = ArgStr("msgId");
        int role = ArgInt("role", 1);
        bool isSub = ArgBool("isSubscribed");
        bool isVip = ArgBool("isVip");
        bool isMod = ArgBool("isModerator");

        // 1. Сообщения своего бота не разбираем.
        if (IsBot(userId)) return false;

        // 2. Первое слово rawInput — команда? (%input0% не годится: там слово без «!»)
        string first = FirstWord(raw);
        if (first.Length == 0) return false;

        string kind = "";
        if (InList(first, G("tapyorCmdOrder", "!sr, !play"))) kind = "order";
        else if (InList(first, G("tapyorCmdSong", "!song"))) kind = "song";
        else if (InList(first, G("tapyorCmdPlace", "!place"))) kind = "place";
        else if (InList(first, G("tapyorCmdCancel", "!cancel"))) kind = "cancel";
        else if (InList(first, G("tapyorCmdSkip", "!skip"))) kind = "skip";
        if (kind.Length == 0) return false;

        // Команда выключена — молчим.
        if (kind == "order" && !GBool("tapyorOnOrder", true)) return false;
        if (kind == "song" && !GBool("tapyorOnSong", true)) return false;
        if (kind == "place" && !GBool("tapyorOnPlace", true)) return false;
        if (kind == "cancel" && !GBool("tapyorOnCancel", true)) return false;
        if (kind == "skip" && !GBool("tapyorOnSkip", true)) return false;

        // 3. Пропуск — только модератор/стример.
        if (kind == "skip" && role < 3)
        {
            string t = GRaw("tapyorTxtSkipNoAccess").Trim();
            if (t.Length == 0) t = "пропускать трек могут модераторы";
            Say(t, msgId);
            return false;
        }

        // 4. Кто может заказывать. Стример и VIP/мод (при tapyorVipFree) — без проверок и пауз.
        bool freePass = role >= 4;
        if (!freePass && role >= 2 && GBool("tapyorVipFree", true)) freePass = true;

        if (kind == "order" && !freePass)
        {
            if (!CanOrder(userId, isSub, isVip, isMod, role))
            {
                Say(NoAccessText(user), msgId);
                return false;
            }

            // 5. Пауза между заказами зрителя.
            int pauseMin = GInt("tapyorPauseMin", 30, 0, 100000);
            if (pauseMin > 0)
            {
                long last = ParseLong(UserVar(userId, "tapyorLastOrder"));
                long now = UnixNow();
                long until = last + (long)pauseMin * 60L;
                if (last > 0 && until > now)
                {
                    int mins = (int)Math.Ceiling((until - now) / 60.0);
                    if (mins < 1) mins = 1;
                    string tpl = GRaw("tapyorTxtPause").Trim();
                    string txt;
                    if (tpl.Length > 0) txt = Subst(tpl, user, "", "", "", "", mins.ToString(), "");
                    else txt = "можно снова через " + mins + " мин";
                    Say(txt, msgId);
                    return false;
                }
            }
        }

        // 6. Адрес порта Тапёра.
        string baseUrl = BaseUrl();
        if (baseUrl.Length == 0)
        {
            Say("Тапёр не подключён к Streamer.bot", msgId);
            return false;
        }

        string url;
        if (kind == "order")
        {
            int perUser = GInt("tapyorPerUser", 1, 1, 20);
            int chatCap = GInt("tapyorChatCap", 10, 1, 200);
            string doubt = G("tapyorDoubt", "wait").Trim().ToLowerInvariant();
            if (doubt != "ask") doubt = "wait";

            url = baseUrl + "/sb/order?user=" + Enc(user)
                + "&uid=" + Enc(userId)
                + "&platform=twitch&kind=cmd&cmd=" + Enc(first)
                + "&text=" + Enc(raw)
                + "&msg=" + Enc(msgId)
                + "&perUser=" + perUser
                + "&chatCap=" + chatCap
                + "&doubt=" + doubt
                + (freePass ? "&free=1" : "")
                + "&v=1";
        }
        else if (kind == "song")
        {
            url = baseUrl + "/sb/now?v=1";
        }
        else if (kind == "place")
        {
            url = baseUrl + "/sb/place?uid=" + Enc(userId) + "&user=" + Enc(user) + "&platform=twitch&v=1";
        }
        else if (kind == "cancel")
        {
            url = baseUrl + "/sb/cancel?uid=" + Enc(userId) + "&user=" + Enc(user) + "&platform=twitch&v=1";
        }
        else
        {
            url = baseUrl + "/sb/control?do=skip&user=" + Enc(user) + "&v=1";
        }

        CPH.SetArgument("tpUrl", url);
        CPH.SetArgument("tpCmd", first);
        CPH.SetArgument("tpMsgId", msgId);
        CPH.SetArgument("tpKind", kind);
        CPH.SetArgument("tpUser", user);
        CPH.SetArgument("tpUserId", userId);
        return true;
    }

    // ---------- общие функции (копия в каждом файле: в Streamer.bot у шагов нет общего кода) ----------

    private string GRaw(string name)
    {
        try
        {
            string v = CPH.GetGlobalVar<string>(name, true);
            return v == null ? "" : v;
        }
        catch { return ""; }
    }

    private string G(string name, string def)
    {
        string v = GRaw(name).Trim();
        return v.Length == 0 ? def : v;
    }

    private bool IsOff(string v)
    {
        v = (v ?? "").Trim().ToLowerInvariant();
        return v == "0" || v == "false" || v == "no" || v == "off" || v == "нет";
    }

    private bool GBool(string name, bool def)
    {
        string v = GRaw(name).Trim().ToLowerInvariant();
        if (v.Length == 0) return def;
        if (IsOff(v)) return false;
        if (v == "1" || v == "true" || v == "yes" || v == "on" || v == "да") return true;
        return def;
    }

    private int GInt(string name, int def, int min, int max)
    {
        string v = GRaw(name).Trim();
        int n;
        if (!int.TryParse(v, out n)) n = def;
        if (n < min) n = min;
        if (n > max) n = max;
        return n;
    }

    private string ArgStr(string name)
    {
        string s;
        if (CPH.TryGetArg(name, out s)) return s == null ? "" : s;
        int i;
        if (CPH.TryGetArg(name, out i)) return i.ToString();
        long l;
        if (CPH.TryGetArg(name, out l)) return l.ToString();
        double d;
        if (CPH.TryGetArg(name, out d)) return d.ToString(System.Globalization.CultureInfo.InvariantCulture);
        bool b;
        if (CPH.TryGetArg(name, out b)) return b ? "True" : "False";
        return "";
    }

    private int ArgInt(string name, int def)
    {
        int n;
        return int.TryParse(ArgStr(name).Trim(), out n) ? n : def;
    }

    private bool ArgBool(string name)
    {
        string v = ArgStr(name).Trim().ToLowerInvariant();
        return v == "1" || v == "true" || v == "yes" || v == "on" || v == "да";
    }

    private string Enc(string s)
    {
        if (s == null) return "";
        byte[] bytes = Encoding.UTF8.GetBytes(s);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < bytes.Length; i++)
        {
            byte b = bytes[i];
            if ((b >= 65 && b <= 90) || (b >= 97 && b <= 122) || (b >= 48 && b <= 57)
                || b == 45 || b == 95 || b == 46 || b == 126)
                sb.Append((char)b);
            else
                sb.Append('%').Append(b.ToString("X2"));
        }
        return sb.ToString();
    }

    private void Say(string text, string msgId)
    {
        if (string.IsNullOrEmpty(text)) return;
        bool useBot = string.Equals(G("tapyorReplyAs", "broadcaster").Trim(), "bot", StringComparison.OrdinalIgnoreCase);
        bool asReply = !string.IsNullOrEmpty(msgId)
            && string.Equals(G("tapyorReplyMode", "reply").Trim(), "reply", StringComparison.OrdinalIgnoreCase);
        // Если у этих методов в 1.0.7 есть 4-й/3-й параметр fallback — добавить «, true» (см. CHECK.md).
        if (asReply) CPH.TwitchReplyToMessage(text, msgId, useBot);
        else CPH.SendMessage(text, useBot);
    }

    private long UnixNow()
    {
        return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds;
    }

    private long ParseLong(string s)
    {
        long n;
        return long.TryParse((s ?? "").Trim(), out n) ? n : 0;
    }

    private string BaseUrl()
    {
        string u = GRaw("tapyorUrl").Trim();
        while (u.EndsWith("/")) u = u.Substring(0, u.Length - 1);
        return u;
    }

    private string FirstWord(string s)
    {
        if (s == null) return "";
        s = s.Trim();
        if (s.Length == 0) return "";
        int i = 0;
        while (i < s.Length && !char.IsWhiteSpace(s[i])) i++;
        return s.Substring(0, i);
    }

    private bool InList(string token, string list)
    {
        if (string.IsNullOrEmpty(list)) return false;
        string[] parts = list.Split(new char[] { ',', ';' });
        for (int i = 0; i < parts.Length; i++)
        {
            string p = parts[i].Trim();
            if (p.Length == 0) continue;
            if (string.Equals(p, token, StringComparison.OrdinalIgnoreCase)) return true;
            if (string.Equals(NoBang(p), NoBang(token), StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private string NoBang(string s)
    {
        s = (s ?? "").Trim();
        while (s.Length > 0 && (s[0] == '!' || s[0] == '@')) s = s.Substring(1);
        return s;
    }

    private string UserVar(string userId, string name)
    {
        if (string.IsNullOrEmpty(userId)) return "";
        try
        {
            string v = CPH.GetTwitchUserVarById<string>(userId, name, true);
            return v == null ? "" : v;
        }
        catch { return ""; }
    }

    private bool CanOrder(string userId, bool isSub, bool isVip, bool isMod, int role)
    {
        string who = G("tapyorWho", "all").Trim().ToLowerInvariant();
        if (who.Length == 0 || who == "all") return true;
        if (who == "sub") return isSub;
        if (who == "vip") return isVip || isMod || role >= 2;
        if (who == "follower") return FollowerOk(userId, GInt("tapyorFollowDays", 0, 0, 100000));
        return true;
    }

    private bool FollowerOk(string userId, int days)
    {
        if (string.IsNullOrEmpty(userId)) return false;
        try
        {
            object info = CPH.TwitchGetExtendedUserInfoById(userId);
            if (info == null) return true; // проверить нечем — не блокируем
            DateTime followed;
            if (!TryFollowDate(info, out followed)) return true; // поля нет — проверку пропускаем
            if (days <= 0) return true;
            double age = (DateTime.UtcNow - followed.ToUniversalTime()).TotalDays;
            return age >= days;
        }
        catch { return true; }
    }

    // Ищем дату фолловинга по разным именам поля: точного имени в 1.0.7 не подтверждено.
    private bool TryFollowDate(object info, out DateTime followed)
    {
        followed = DateTime.MinValue;
        if (info == null) return false;
        try
        {
            Type t = info.GetType();
            string[] names = new string[] { "FollowedAt", "FollowDate", "FollowedAtUtc", "FollowedAtDateTime", "Followed" };
            for (int i = 0; i < names.Length; i++)
            {
                object v = null;
                PropertyInfo p = t.GetProperty(names[i], BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
                if (p != null) v = p.GetValue(info, null);
                else
                {
                    FieldInfo f = t.GetField(names[i], BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
                    if (f != null) v = f.GetValue(info);
                }
                if (v == null) continue;
                if (v is DateTime) { followed = (DateTime)v; return true; }
                if (v is DateTimeOffset) { followed = ((DateTimeOffset)v).UtcDateTime; return true; }
                DateTime tmp;
                if (DateTime.TryParse(Convert.ToString(v), out tmp)) { followed = tmp; return true; }
            }
        }
        catch { }
        return false;
    }

    private string NoAccessText(string user)
    {
        string t = GRaw("tapyorTxtNoAccess").Trim();
        if (t.Length > 0) return Subst(t, user, "", "", "", "", "", WhoText());
        string who = G("tapyorWho", "all").Trim().ToLowerInvariant();
        if (who == "follower")
        {
            int d = GInt("tapyorFollowDays", 0, 0, 100000);
            return d > 0 ? "заказывать могут фолловеры от " + d + " дн." : "заказывать могут фолловеры";
        }
        if (who == "sub") return "заказывать могут подписчики";
        if (who == "vip") return "заказывать могут VIP и модераторы";
        return "заказывать сейчас нельзя";
    }

    // Единый набор подстановок: {user} {track} {place} {eta} {reason} {min} {who} (аудит 0.35).
    private string Subst(string tpl, string user, string track, string place, string eta, string reason, string min, string who)
    {
        if (string.IsNullOrEmpty(tpl)) return "";
        return tpl.Replace("{user}", user ?? "")
                  .Replace("{track}", track ?? "")
                  .Replace("{place}", place ?? "")
                  .Replace("{eta}", eta ?? "")
                  .Replace("{reason}", reason ?? "")
                  .Replace("{min}", min ?? "")
                  .Replace("{who}", who ?? "");
    }

    // Кому можно заказывать — для подстановки {who} в своей фразе «Нет доступа».
    private string WhoText()
    {
        string who = G("tapyorWho", "all").Trim().ToLowerInvariant();
        if (who == "follower")
        {
            int d = GInt("tapyorFollowDays", 0, 0, 100000);
            return d > 0 ? "фолловеров (от " + d + " дней)" : "фолловеров";
        }
        if (who == "sub") return "подписчиков";
        if (who == "vip") return "VIP и модераторов";
        return "всех";
    }

    private string PropStr(object obj, params string[] names)
    {
        if (obj == null) return "";
        if (obj is string) return (string)obj;
        try
        {
            Type t = obj.GetType();
            for (int i = 0; i < names.Length; i++)
            {
                PropertyInfo p = t.GetProperty(names[i], BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
                object v = p != null ? p.GetValue(obj, null) : null;
                if (v == null)
                {
                    FieldInfo f = t.GetField(names[i], BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
                    if (f != null) v = f.GetValue(obj);
                }
                if (v != null) return Convert.ToString(v);
            }
        }
        catch { }
        return "";
    }

    private bool IsBot(string userId)
    {
        if (string.IsNullOrEmpty(userId)) return false;
        try
        {
            object bot = CPH.TwitchGetBot();
            string id = PropStr(bot, "Id", "UserId");
            return id.Length > 0 && string.Equals(id, userId, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }
}
