using System;
using System.Text;

// «Тапёр: ответ» — поздний итог поиска (из почтового ящика Тапёра).
// args: reply, msgId, user, platform, kind, reward, redemption, refund, eventId.
// reply — в чат как обычный ответ; refund=true и есть redemption — вернуть баллы; затем ack.
public class CPHInline
{
    public bool Execute()
    {
        string reply = ArgStr("reply").Trim();
        string msgId = ArgStr("msgId");
        string user = ArgStr("user");
        string kind = ArgStr("kind").Trim().ToLowerInvariant();
        string rewardId = ArgStr("reward").Trim();
        string redemptionId = ArgStr("redemption").Trim();
        bool refund = ArgBool("refund");

        if (refund)
        {
            if (rewardId.Length > 0 && redemptionId.Length > 0)
            {
                try { CPH.TwitchRedemptionCancel(rewardId, redemptionId); } catch { }
            }
            RemovePending(rewardId, redemptionId);
        }
        else if (kind == "points" && redemptionId.Length > 0)
        {
            // Поздний поиск всё-таки поставил заказ за баллы — держим списание на сверке.
            AddPending(rewardId, redemptionId);
        }

        if (reply.Length > 0)
        {
            string text = Subst(reply, user, ArgStr("track"), ArgStr("place"), ArgStr("etaMin"), ArgStr("reason"));
            Say(text, msgId);
        }

        string ack = AckUrl(ArgStr("eventId"));
        if (ack.Length == 0) return false;
        CPH.SetArgument("tpUrl", ack);
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

    // Единый набор подстановок: {user} {track} {place} {eta} {reason} {min} {who} (аудит 0.35).
    private string Subst(string tpl, string user, string track, string place, string eta, string reason, string min = "", string who = "")
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

    private string BaseUrl()
    {
        string u = GRaw("tapyorUrl").Trim();
        while (u.EndsWith("/")) u = u.Substring(0, u.Length - 1);
        return u;
    }

    private string AckUrl(string eventId)
    {
        if (string.IsNullOrEmpty(eventId)) return "";
        string b = BaseUrl();
        if (b.Length == 0) return "";
        return b + "/sb/ack?id=" + Enc(eventId);
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
