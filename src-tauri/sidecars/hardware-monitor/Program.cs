using System.Diagnostics;
using System.Text.Json;
using LibreHardwareMonitor.Hardware;

var intervalMs = ReadIntArgument(args, "--interval-ms", 2_000, 500, 30_000);
var parentPid = ReadIntArgument(args, "--parent-pid", 0, 0, int.MaxValue);
var debug = args.Contains("--debug", StringComparer.OrdinalIgnoreCase);
var once = args.Contains("--once", StringComparer.OrdinalIgnoreCase);
var outputFile = ReadStringArgument(args, "--output-file");

var computer = new Computer
{
    IsCpuEnabled = true,
    IsMotherboardEnabled = true,
    IsControllerEnabled = true,
    IsMemoryEnabled = false,
    IsGpuEnabled = false,
    IsNetworkEnabled = false,
    IsStorageEnabled = false,
};

computer.Open();
try
{
    while (ParentIsRunning(parentPid))
    {
        var temperatures = new List<SensorReading>();
        var fans = new List<SensorReading>();
        foreach (var hardware in computer.Hardware)
        {
            if (debug)
            {
                DumpHardware(hardware, 0);
            }
            CollectSensors(hardware, temperatures, fans, hardware.HardwareType == HardwareType.Cpu);
        }

        var temperature = SelectCpuTemperature(temperatures);
        var fanRpm = fans
            .Where(reading => reading.Value > 0)
            .Select(reading => reading.Value)
            .DefaultIfEmpty()
            .Max();

        var json = JsonSerializer.Serialize(new
        {
            cpuTemperatureC = temperature,
            fanRpm = fanRpm > 0 ? (uint?)Math.Round(fanRpm) : null,
            timestampMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        });
        if (string.IsNullOrWhiteSpace(outputFile))
        {
            Console.WriteLine(json);
            Console.Out.Flush();
        }
        else
        {
            WriteSensorFile(outputFile, json);
        }
        if (once)
        {
            break;
        }
        Thread.Sleep(intervalMs);
    }
}
finally
{
    computer.Close();
}

static void CollectSensors(
    IHardware hardware,
    List<SensorReading> temperatures,
    List<SensorReading> fans,
    bool cpuHardware)
{
    hardware.Update();
    foreach (var sensor in hardware.Sensors)
    {
        if (sensor.Value is not float value || !float.IsFinite(value))
        {
            continue;
        }
        if (cpuHardware && sensor.SensorType == SensorType.Temperature)
        {
            temperatures.Add(new SensorReading(sensor.Name, value));
        }
        else if (sensor.SensorType == SensorType.Fan)
        {
            fans.Add(new SensorReading(sensor.Name, value));
        }
    }

    foreach (var subHardware in hardware.SubHardware)
    {
        CollectSensors(subHardware, temperatures, fans, cpuHardware);
    }
}

static void DumpHardware(IHardware hardware, int depth)
{
    hardware.Update();
    var indent = new string(' ', depth * 2);
    Console.Error.WriteLine($"{indent}{hardware.HardwareType}: {hardware.Name}");
    foreach (var sensor in hardware.Sensors)
    {
        Console.Error.WriteLine(
            $"{indent}  {sensor.SensorType}: {sensor.Name} = {sensor.Value?.ToString() ?? "null"}");
    }
    foreach (var subHardware in hardware.SubHardware)
    {
        DumpHardware(subHardware, depth + 1);
    }
}

static float? SelectCpuTemperature(IReadOnlyCollection<SensorReading> readings)
{
    if (readings.Count == 0)
    {
        return null;
    }

    var preferredNames = new[] { "package", "tctl", "tdie", "core average", "cpu" };
    foreach (var preferredName in preferredNames)
    {
        var preferred = readings
            .Where(reading => reading.Name.Contains(preferredName, StringComparison.OrdinalIgnoreCase))
            .Select(reading => reading.Value)
            .Where(IsPlausibleTemperature)
            .ToArray();
        if (preferred.Length > 0)
        {
            return preferred.Max();
        }
    }

    var fallback = readings
        .Select(reading => reading.Value)
        .Where(IsPlausibleTemperature)
        .ToArray();
    return fallback.Length > 0 ? fallback.Max() : null;
}

static bool IsPlausibleTemperature(float value) => value is > -20 and < 150;

static int ReadIntArgument(
    IReadOnlyList<string> args,
    string name,
    int fallback,
    int minimum,
    int maximum)
{
    for (var index = 0; index + 1 < args.Count; index++)
    {
        if (args[index] == name && int.TryParse(args[index + 1], out var value))
        {
            return Math.Clamp(value, minimum, maximum);
        }
    }
    return fallback;
}

static string? ReadStringArgument(IReadOnlyList<string> args, string name)
{
    for (var index = 0; index + 1 < args.Count; index++)
    {
        if (args[index] == name)
        {
            return args[index + 1];
        }
    }
    return null;
}

static void WriteSensorFile(string path, string json)
{
    var directory = Path.GetDirectoryName(path);
    if (!string.IsNullOrWhiteSpace(directory))
    {
        Directory.CreateDirectory(directory);
    }
    var temporaryPath = $"{path}.tmp";
    File.WriteAllText(temporaryPath, json);
    File.Move(temporaryPath, path, true);
}

static bool ParentIsRunning(int parentPid)
{
    if (parentPid <= 0)
    {
        return true;
    }
    try
    {
        return !Process.GetProcessById(parentPid).HasExited;
    }
    catch
    {
        return false;
    }
}

internal readonly record struct SensorReading(string Name, float Value);
