using System;

// «Тапёр: триггеры» — регистрация событий «Тапёр → …» для действий стримера.
// У шага Execute C# Code включить «Precompile on Application Start» (см. BUILD.md).
// Init вызывается при старте Streamer.bot, Execute — при ручном запуске действия.
public class CPHInline
{
    private static bool _registered = false;

    public void Init()
    {
        RegisterAll();
    }

    public bool Execute()
    {
        RegisterAll();
        return true;
    }

    private void RegisterAll()
    {
        if (_registered) return;

        CPH.RegisterCustomTrigger("Заказ принят", "tapyor_order_queued", new string[] { "Тапёр" });
        CPH.RegisterCustomTrigger("Заказ ждёт стримера", "tapyor_order_pending", new string[] { "Тапёр" });
        CPH.RegisterCustomTrigger("Заказ выполнен", "tapyor_order_played", new string[] { "Тапёр" });
        CPH.RegisterCustomTrigger("Заказ снят", "tapyor_order_dropped", new string[] { "Тапёр" });
        CPH.RegisterCustomTrigger("Заиграл трек", "tapyor_track_started", new string[] { "Тапёр" });
        CPH.RegisterCustomTrigger("Очередь заказов пуста", "tapyor_queue_empty", new string[] { "Тапёр" });
        CPH.RegisterCustomTrigger("Приём заказов изменён", "tapyor_accept_changed", new string[] { "Тапёр" });

        _registered = true;
    }
}
