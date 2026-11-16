using System;
using System.Text;

// «Тапёр: сверка» — Тапёр при подключении присылает pending: номера redemption, которые реально ждут/играют.
// Всё, чего в этом списке нет, но что мы считали висящим, — закрываем (возврат баллов), затем ack.
// args: pending (строка, через запятую), eventId.
public class CPHInline
{
    public bool Execute()
    {
        string pendingArg;
        bool hasPending = CPH.TryGetArg("pending", out pendingArg);
        // Тапёр всегда шлёт pendingOk=1 вместе со списком. Нет флага (ручной запуск, старый Тапёр) —
        // ничего не отменяем: иначе пустой список закроет все висящие списания (аудит 0.35).
        bool pendingOk = string.Equals(ArgStr("pendingOk").Trim(), "1", StringComparison.OrdinalIgnoreCase);

        // Нет аргумента pending (например, ручной Test Trigger) — ничего не закрываем.
        if (pendingOk && hasPending)
        {
            string pending = pendingArg == null ? "" : pendingArg;
            string cur = GRaw("tapyorPendingRedemptions");
            StringBuilder keep = new StringBuilder();

            if (cur.Trim().Length > 0)
            {
                string[] parts = cur.Split(';');
                for (int i = 0; i < parts.Length; i++)
                {
                    string entry = parts[i].Trim();
                    if (entry.Length == 0) continue;

                    int c = entry.IndexOf(':');
                    if (c <= 0 || c >= entry.Length - 1) continue;
                    string rewardId = entry.Substring(0, c).Trim();
                    string redemptionId = entry.Substring(c + 1).Trim();
                    if (rewardId.Length == 0 || redemptionId.Length == 0) continue;

                    if (InPendingList(redemptionId, pending))
                    {
                        if (keep.Length > 0) keep.Append(';');
                        keep.Append(rewardId).Append(':').Append(redemptionId);
                    }
                    else
                    {
                        try { CPH.TwitchRedemptionCancel(rewardId, redemptionId); } catch { }
                    }
                }
            }

            try { CPH.SetGlobalVar("tapyorPendingRedemptions", keep.ToString(), true); } catch { }
        }

        string ack = AckUrl(ArgStr("eventId"));
        if (ack.Length == 0) return false;
        CPH.SetArgument("tpUrl", ack);
        return true;
    }

    // ---------- общие функции (копия в каждом файле) ----------

    private bool InPendingList(string redemptionId, string list)
    {
        if (string.IsNullOrEmpty(list)) return false;
        string[] parts = list.Split(new char[] { ',', ';', ' ', '\t', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
        for (int i = 0; i < parts.Length; i++)
        {
            string p = parts[i].Trim();
            int c = p.LastIndexOf(':');
            if (c >= 0 && c < p.Length - 1) p = p.Substring(c + 1);
            if (string.Equals(p, redemptionId, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

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
}
