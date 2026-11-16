using System;
using System.Text;

// «Тапёр: заказ выполнен» — засчитать баллы и убрать списание из висящих, затем ack.
// args от Тапёра: reward, redemption, eventId (у заказов из чата reward/redemption пустые).
public class CPHInline
{
    public bool Execute()
    {
        string rewardId = ArgStr("reward").Trim();
        string redemptionId = ArgStr("redemption").Trim();

        if (rewardId.Length > 0 && redemptionId.Length > 0)
        {
            try { CPH.TwitchRedemptionFulfill(rewardId, redemptionId); } catch { }
        }
        RemovePending(rewardId, redemptionId);

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
