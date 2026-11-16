using System;
using System.Text;

// «Тапёр: награда», шаг 3 — ответ по res.*, возврат баллов, учёт висящих списаний.
// Висящие списания: global tapyorPendingRedemptions = «reward:redemption» через «;» (для «сверки»).
public class CPHInline
{
    public bool Execute()
    {
        string rewardId = ArgStr("tpRewardId").Trim();
        if (rewardId.Length == 0) rewardId = ArgStr("rewardId").Trim();
        string redemptionId = ArgStr("tpRedemptionId").Trim();
        if (redemptionId.Length == 0) redemptionId = ArgStr("redemptionId").Trim();
        string userId = ArgStr("tpUserId");
        if (userId.Length == 0) userId = ArgStr("userId");
        string user = ArgStr("tpUser");
        if (user.Length == 0) user = ArgStr("user");

        string st = ArgStr("res.status").Trim().ToLowerInvariant();
        bool refund = ArgBool("res.refund");

        // Тапёр не ответил — баллы сразу вернуть.
        if (st.Length == 0)
        {
            Cancel(rewardId, redemptionId);
            RemovePending(rewardId, redemptionId);
            string t = GRaw("tapyorTxtOffline").Trim();
            if (t.Length == 0) t = (user.Length > 0 ? "@" + user + ", " : "") + "плеер сейчас не принимает заказы";
            t = Subst(t, user, "", "", "", "", "", "");
            Say(t, "");
            return true;
        }

        // Тапёр просит вернуть баллы (notfound/rule/limit/closed/ask/error/off).
        if (refund)
        {
            Cancel(rewardId, redemptionId);
            RemovePending(rewardId, redemptionId);
            string text = ReplyText(st, user);
            if (text.Length == 0) text = "заказ не принят, баллы возвращены";
            Say(text, "");
            return true;
        }

        // off без refund — на всякий случай возвращаем и молчим.
        if (st == "off")
        {
            Cancel(rewardId, redemptionId);
            RemovePending(rewardId, redemptionId);
            return true;
        }

        // Заказ ждёт/играет — запоминаем списание для сверки и время для паузы.
        if (st == "queued" || st == "pending" || st == "search")
        {
            AddPending(rewardId, redemptionId);
            SetUserVar(userId, "tapyorLastOrder", UnixNow().ToString());
        }
        else
        {
            RemovePending(rewardId, redemptionId);
        }

        string txt = ReplyText(st, user);

        Say(txt, "");
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

    private bool ArgBool(string name)
    {
        string v = ArgStr(name).Trim().ToLowerInvariant();
        return v == "1" || v == "true" || v == "yes" || v == "on" || v == "да";
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
        if (v.Length == 0) v = GRaw("tapyorTxt" + s);
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

    private void Cancel(string rewardId, string redemptionId)
    {
        if (string.IsNullOrEmpty(rewardId) || string.IsNullOrEmpty(redemptionId)) return;
        try { CPH.TwitchRedemptionCancel(rewardId, redemptionId); } catch { }
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

    private string PendingKey(string rewardId, string redemptionId)
    {
        if (string.IsNullOrEmpty(rewardId) || string.IsNullOrEmpty(redemptionId)) return "";
        return rewardId.Trim() + ":" + redemptionId.Trim();
    }

    private void AddPending(string rewardId, string redemptionId)
    {
        string key = PendingKey(rewardId, redemptionId);
        if (key.Length == 0) return;
        string cur = GRaw("tapyorPendingRedemptions");
        string[] parts = cur.Split(';');
        for (int i = 0; i < parts.Length; i++)
            if (string.Equals(parts[i].Trim(), key, StringComparison.OrdinalIgnoreCase)) return;
        string next = cur.Trim();
        if (next.Length > 0) next += ";";
        next += key;
        try { CPH.SetGlobalVar("tapyorPendingRedemptions", next, true); } catch { }
    }

    private void RemovePending(string rewardId, string redemptionId)
    {
        string key = PendingKey(rewardId, redemptionId);
        if (key.Length == 0) return;
        string cur = GRaw("tapyorPendingRedemptions");
        if (cur.Length == 0) return;
        string[] parts = cur.Split(';');
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < parts.Length; i++)
        {
            string p = parts[i].Trim();
            if (p.Length == 0) continue;
            if (string.Equals(p, key, StringComparison.OrdinalIgnoreCase)) continue;
            if (sb.Length > 0) sb.Append(';');
            sb.Append(p);
        }
        try { CPH.SetGlobalVar("tapyorPendingRedemptions", sb.ToString(), true); } catch { }
    }
}
