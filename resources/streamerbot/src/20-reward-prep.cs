using System;
using System.Reflection;
using System.Text;

// «Тапёр: награда», шаг 1 — проверки награды и сборка адреса в tpUrl.
// kind=points, reward + redemption; при отказе/паузе возвращаем баллы (TwitchRedemptionCancel).
public class CPHInline
{
    public bool Execute()
    {
        // Сначала номера награды и списания: без них нельзя вернуть баллы, если заказ не принимается (аудит 0.35).
        string rewardId = ArgStr("rewardId").Trim();
        string redemptionId = ArgStr("redemptionId").Trim();
        string rewardName = ArgStr("rewardName").Trim();
        if (redemptionId.Length == 0) return false;

        string userId = ArgStr("userId");
        string user = ArgStr("user");
        if (user.Length == 0) user = ArgStr("userName");
        string raw = ArgStr("rawInput");
        bool isSub = ArgBool("isSubscribed");
        bool isVip = ArgBool("isVip");
        bool isMod = ArgBool("isModerator");
        int role = ArgInt("role", 0);
        if (role <= 0)
        {
            // У награды %role% может не быть — выводим из флагов.
            if (isMod) role = 3;
            else if (isVip) role = 2;
            else role = 1;
        }

        // Та ли это награда? Сначала номер, потом название (награду могли пересоздать).
        string wantId = GRaw("tapyorRewardId").Trim();
        string wantName = G("tapyorRewardName", "Заказать песню");
        bool same = false;
        if (wantId.Length > 0 && string.Equals(wantId, rewardId, StringComparison.OrdinalIgnoreCase)) same = true;
        if (!same && string.Equals(wantName.Trim(), rewardName, StringComparison.OrdinalIgnoreCase)) same = true;
        if (!same) return false;

        // Баллы выключены — вернуть баллы и выйти: раньше списание висело, а экран говорил «выключено».
        if (!GBool("tapyorPoints", true))
        {
            Cancel(rewardId, redemptionId);
            return false;
        }

        string baseUrl = BaseUrl();
        if (baseUrl.Length == 0)
        {
            Cancel(rewardId, redemptionId);
            Say("Тапёр не подключён к Streamer.bot", "");
            return false;
        }

        // Стример и VIP/мод (при tapyorVipFree) — без проверок и пауз.
        bool freePass = role >= 4;
        if (!freePass && role >= 2 && GBool("tapyorVipFree", true)) freePass = true;

        if (!freePass)
        {
            if (!CanOrder(userId, isSub, isVip, isMod, role))
            {
                Cancel(rewardId, redemptionId);
                Say(NoAccessText(user), "");
                return false;
            }

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
                    Cancel(rewardId, redemptionId);
                    string tpl = GRaw("tapyorTxtPause").Trim();
                    string txt;
                    if (tpl.Length > 0) txt = Subst(tpl, user, "", "", "", "", mins.ToString(), "");
                    else txt = "можно снова через " + mins + " мин";
                    Say(txt, "");
                    return false;
                }
            }
        }

        int perUser = GInt("tapyorPerUser", 1, 1, 20);
        int chatCap = GInt("tapyorChatCap", 10, 1, 200);
        string doubt = G("tapyorDoubt", "wait").Trim().ToLowerInvariant();
        if (doubt != "ask") doubt = "wait";

        string url = baseUrl + "/sb/order?user=" + Enc(user)
            + "&uid=" + Enc(userId)
            + "&platform=twitch&kind=points"
            + "&text=" + Enc(raw)
            + "&reward=" + Enc(rewardId)
            + "&redemption=" + Enc(redemptionId)
            + "&perUser=" + perUser
            + "&chatCap=" + chatCap
            + "&doubt=" + doubt
            + (freePass ? "&free=1" : "")
            + "&v=1";

        CPH.SetArgument("tpUrl", url);
        CPH.SetArgument("tpKind", "points");
        CPH.SetArgument("tpMsgId", "");
        CPH.SetArgument("tpUser", user);
        CPH.SetArgument("tpUserId", userId);
        CPH.SetArgument("tpRewardId", rewardId);
        CPH.SetArgument("tpRedemptionId", redemptionId);
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
        if (asReply) CPH.TwitchReplyToMessage(text, msgId, useBot);
        else CPH.SendMessage(text, useBot);
    }

    private void Cancel(string rewardId, string redemptionId)
    {
        if (string.IsNullOrEmpty(rewardId) || string.IsNullOrEmpty(redemptionId)) return;
        try { CPH.TwitchRedemptionCancel(rewardId, redemptionId); } catch { }
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
            if (info == null) return true;
            DateTime followed;
            if (!TryFollowDate(info, out followed)) return true;
            if (days <= 0) return true;
            double age = (DateTime.UtcNow - followed.ToUniversalTime()).TotalDays;
            return age >= days;
        }
        catch { return true; }
    }

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
}
