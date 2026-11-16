using System;
using System.Collections;
using System.Reflection;
using System.Text;

// «Тапёр: найти награду» — найти награду по названию (без регистра) и записать её номер в tapyorRewardId.
// Затем ack. args: eventId.
public class CPHInline
{
    public bool Execute()
    {
        string want = G("tapyorRewardName", "Заказать песню").Trim();
        if (want.Length == 0) want = "Заказать песню";

        string foundId = "";
        try
        {
            object rewards = CPH.TwitchGetRewards();
            IEnumerable list = rewards as IEnumerable;
            if (list != null)
            {
                foreach (object r in list)
                {
                    string title = PropStr(r, "Title", "Name", "RewardName");
                    string id = PropStr(r, "Id", "RewardId");
                    if (title.Length > 0 && id.Length > 0
                        && string.Equals(title.Trim(), want, StringComparison.OrdinalIgnoreCase))
                    {
                        foundId = id;
                        break;
                    }
                }
            }
        }
        catch { }

        if (foundId.Length > 0)
        {
            try { CPH.SetGlobalVar("tapyorRewardId", foundId, true); } catch { }
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
