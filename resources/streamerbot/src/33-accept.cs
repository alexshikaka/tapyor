using System;
using System.Text;

// «Тапёр: приём» — открыть/закрыть приём: пауза награды за баллы, затем ack.
// args: open = 1/0. Пауза — только если tapyorPauseReward = да и tapyorRewardId задан.
public class CPHInline
{
    public bool Execute()
    {
        string openRaw = ArgStr("open").Trim();
        if (openRaw.Length > 0 && GBool("tapyorPauseReward", true))
        {
            string rewardId = GRaw("tapyorRewardId").Trim();
            if (rewardId.Length > 0)
            {
                bool isOpen = openRaw == "1"
                    || string.Equals(openRaw, "true", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(openRaw, "on", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(openRaw, "да", StringComparison.OrdinalIgnoreCase);
                try
                {
                    if (isOpen) CPH.UnPauseReward(rewardId);
                    else CPH.PauseReward(rewardId);
                }
                catch { }
            }
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
