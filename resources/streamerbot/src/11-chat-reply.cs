using System;

// «Тапёр: заказ», шаг 3 — ответ по res.* (после Fetch URL).
// Своя фраза стримера tapyorTxt<Status> важнее res.reply; подстановки {user} {track} {place} {eta} {reason}.
public class CPHInline
{
    public bool Execute()
    {
        string kind = ArgStr("tpKind");
        string msgId = ArgStr("tpMsgId");
        string userId = ArgStr("tpUserId");
        string user = ArgStr("tpUser");
        string st = ArgStr("res.status").Trim().ToLowerInvariant();

        // Порт не ответил (Тапёр закрыт, ошибка, не JSON) — переменных res.* нет.
        if (st.Length == 0)
        {
            string t = GRaw("tapyorTxtOffline").Trim();
            if (t.Length == 0) t = (user.Length > 0 ? "@" + user + ", " : "") + "плеер сейчас не принимает заказы";
            t = Subst(t, user, "", "", "", "", "", "");
            Say(t, msgId);
            return true;
        }

        // Заказы из чата принимает бот пака — шаблон молчит.
        if (st == "off") return true;

        // Заказ принят/ждёт/ищется — запоминаем время для паузы между заказами.
        if (kind == "order" && (st == "queued" || st == "pending" || st == "search"))
            SetUserVar(userId, "tapyorLastOrder", UnixNow().ToString());

        string text = ReplyText(st, user);
        Say(text, msgId);
        return true;
    }

    // ---------- общие функции (копия в каждом файле) ----------

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

    private string CustomText(string status)
    {
        if (string.IsNullOrEmpty(status)) return "";
        string s = status.Trim();
        string suffix;
        if (string.Equals(s, "notfound", StringComparison.OrdinalIgnoreCase)) suffix = "NotFound";
        else suffix = char.ToUpperInvariant(s[0]) + (s.Length > 1 ? s.Substring(1) : "");
        string v = GRaw("tapyorTxt" + suffix);
        if (v.Length == 0) v = GRaw("tapyorTxt" + char.ToUpperInvariant(s[0]) + (s.Length > 1 ? s.Substring(1) : ""));
        if (v.Length == 0) v = GRaw("tapyorTxt" + s); // запасной вариант написания
        return v.Trim();
    }

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

    // Своя фраза важнее ответа Тапёра, но при мгновенном старте (etaMin=0) «Поставил»
    // соврала бы «через ~0 мин» — берём фразу Тапёра «играет сейчас» (аудит 0.35).
    private string ReplyText(string st, string user)
    {
        string text = CustomText(st);
        if (text.Length == 0) return ArgStr("res.reply");
        if (st == "queued" && ArgStr("res.etaMin").Trim() == "0") return ArgStr("res.reply");
        return Subst(text, user, ArgStr("res.track"), ArgStr("res.place"),
            ArgStr("res.etaMin"), ArgStr("res.reason"), ArgStr("res.etaMin"), "");
    }

    private void Say(string text, string msgId)
    {
        if (string.IsNullOrEmpty(text)) return;
        // Twitch не принимает сообщение длиннее 500 символов — обрезаем до 480 с многоточием (аудит 0.35).
        if (text.Length > 480) text = text.Substring(0, 479) + "…";
        bool useBot = string.Equals(G("tapyorReplyAs", "broadcaster").Trim(), "bot", StringComparison.OrdinalIgnoreCase);
        bool asReply = !string.IsNullOrEmpty(msgId)
            && string.Equals(G("tapyorReplyMode", "reply").Trim(), "reply", StringComparison.OrdinalIgnoreCase);
        if (asReply) CPH.TwitchReplyToMessage(text, msgId, useBot);
        else CPH.SendMessage(text, useBot);
    }

    private void SetUserVar(string userId, string name, string value)
    {
        if (string.IsNullOrEmpty(userId)) return;
        try { CPH.SetTwitchUserVarById(userId, name, value, true); } catch { }
    }

    private long UnixNow()
    {
        return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds;
    }
}
