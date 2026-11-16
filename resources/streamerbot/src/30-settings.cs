using System;
using System.Text;

// «Тапёр: настройка» — Тапёр при подключении/изменении настроек шлёт DoAction с args.
// Пишем все tapyor[A-Za-z]+ в persisted-глобальные, затем подтверждаем доставку через /sb/ack.
public class CPHInline
{
    public bool Execute()
    {
        string urlArg = "";
        // args — словарь аргументов действия, встроен в CPHInline Streamer.bot (CPH.GetArguments нет).
        var a = args;
        if (a != null)
        {
            foreach (var kv in a)
            {
                string name = kv.Key;
                if (string.IsNullOrEmpty(name)) continue;
                if (!IsTapyorName(name)) continue;

                object val = kv.Value;
                if (val == null) continue;

                string s;
                if (val is string) s = (string)val;
                else if (val is IFormattable) s = ((IFormattable)val).ToString(null, System.Globalization.CultureInfo.InvariantCulture);
                else s = Convert.ToString(val);
                if (s == null) s = "";

                if (string.Equals(name, "tapyorUrl", StringComparison.OrdinalIgnoreCase)) urlArg = s.Trim();
                try { CPH.SetGlobalVar(name, s, true); } catch { }
            }
        }

        string eventId = ArgStr("eventId");
        string baseUrl = urlArg;
        if (baseUrl.Length == 0) baseUrl = BaseUrl();
        while (baseUrl.EndsWith("/")) baseUrl = baseUrl.Substring(0, baseUrl.Length - 1);
        if (eventId.Length == 0 || baseUrl.Length == 0) return false;

        CPH.SetArgument("tpUrl", baseUrl + "/sb/ack?id=" + Enc(eventId));
        return true;
    }

    // ---------- общие функции (копия в каждом файле) ----------

    private bool IsTapyorName(string name)
    {
        if (!name.StartsWith("tapyor", StringComparison.Ordinal)) return false;
        if (name.Length <= 6) return false;
        for (int i = 6; i < name.Length; i++)
        {
            char c = name[i];
            if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))) return false;
        }
        return true;
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
