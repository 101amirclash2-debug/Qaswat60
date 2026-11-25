package com.fahescar.app;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.net.SocketTimeoutException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** OBD-II Mode 01/03/07/0A/09 readers and SAE J1979 value decoders. */
public final class ObdDiagnostics {
    public interface ProgressListener {
        void onProgress(String message);
    }

    public static final class Reading {
        public final int pid;
        public final String name;
        public final String value;
        public final String unit;
        public final Double numericValue;

        Reading(int pid, String name, String value, String unit, Double numericValue) {
            this.pid = pid;
            this.name = name;
            this.value = value;
            this.unit = unit;
            this.numericValue = numericValue;
        }

        JSONObject toJson() throws JSONException {
            JSONObject object = new JSONObject();
            object.put("pid", pid);
            object.put("name", name);
            object.put("value", value);
            object.put("unit", unit);
            if (numericValue == null) object.put("numeric", JSONObject.NULL);
            else object.put("numeric", numericValue);
            return object;
        }

        static Reading fromJson(JSONObject object) {
            int pid = object.optInt("pid", -1);
            Object numeric = object.opt("numeric");
            Double numericValue = numeric instanceof Number ? ((Number) numeric).doubleValue() : null;
            return new Reading(pid, object.optString("name"), object.optString("value"), object.optString("unit"), numericValue);
        }
    }

    public static final class Dtc {
        public final String code;
        public final List<String> statuses = new ArrayList<>();
        public final String title;
        public final String explanation;

        Dtc(String code) {
            this.code = code;
            DtcCatalog.Definition definition = DtcCatalog.lookup(code);
            this.title = definition.title;
            this.explanation = definition.explanation;
        }

        JSONObject toJson() throws JSONException {
            JSONObject object = new JSONObject();
            object.put("code", code);
            object.put("title", title);
            object.put("explanation", explanation);
            JSONArray statusArray = new JSONArray();
            for (String status : statuses) statusArray.put(status);
            object.put("statuses", statusArray);
            return object;
        }

        static Dtc fromJson(JSONObject object) {
            Dtc dtc = new Dtc(object.optString("code"));
            JSONArray statusArray = object.optJSONArray("statuses");
            if (statusArray != null) {
                for (int i = 0; i < statusArray.length(); i++) {
                    String status = statusArray.optString(i);
                    if (!status.isEmpty() && !dtc.statuses.contains(status)) dtc.statuses.add(status);
                }
            }
            return dtc;
        }
    }

    public static final class EcuStatus {
        public final boolean milOn;
        public final int reportedDtcCount;
        EcuStatus(boolean milOn, int reportedDtcCount) {
            this.milOn = milOn;
            this.reportedDtcCount = reportedDtcCount;
        }
    }

    public static final class ScanReport {
        public long id;
        public long vehicleId;
        public long timestamp;
        public String vehicleName = "";
        public String vehicleVin = "";
        public String adapterName = "";
        public String protocol = "";
        public String ecuVin = "";
        public boolean ecuResponded;
        public boolean milStatusKnown;
        public boolean milOn;
        public int reportedDtcCount = -1;
        public final Map<Integer, Reading> readings = new LinkedHashMap<>();
        public final List<Dtc> dtcs = new ArrayList<>();
        public final List<String> warnings = new ArrayList<>();

        public JSONObject toJson() {
            JSONObject object = new JSONObject();
            try {
                object.put("id", id);
                object.put("vehicleId", vehicleId);
                object.put("timestamp", timestamp);
                object.put("vehicleName", vehicleName);
                object.put("vehicleVin", vehicleVin);
                object.put("adapterName", adapterName);
                object.put("protocol", protocol);
                object.put("ecuVin", ecuVin);
                object.put("ecuResponded", ecuResponded);
                object.put("milStatusKnown", milStatusKnown);
                object.put("milOn", milOn);
                object.put("reportedDtcCount", reportedDtcCount);
                JSONArray readingArray = new JSONArray();
                for (Reading reading : readings.values()) readingArray.put(reading.toJson());
                object.put("readings", readingArray);
                JSONArray dtcArray = new JSONArray();
                for (Dtc dtc : dtcs) dtcArray.put(dtc.toJson());
                object.put("dtcs", dtcArray);
                JSONArray warningArray = new JSONArray();
                for (String warning : warnings) warningArray.put(warning);
                object.put("warnings", warningArray);
            } catch (JSONException ignored) {
                // All values above are JSON primitives/objects and are locally generated.
            }
            return object;
        }

        public static ScanReport fromJson(String raw) throws JSONException {
            JSONObject object = new JSONObject(raw);
            ScanReport report = new ScanReport();
            report.id = object.optLong("id");
            report.vehicleId = object.optLong("vehicleId");
            report.timestamp = object.optLong("timestamp");
            report.vehicleName = object.optString("vehicleName");
            report.vehicleVin = object.optString("vehicleVin");
            report.adapterName = object.optString("adapterName");
            report.protocol = object.optString("protocol");
            report.ecuVin = object.optString("ecuVin");
            report.ecuResponded = object.optBoolean("ecuResponded");
            report.milStatusKnown = object.optBoolean("milStatusKnown");
            report.milOn = object.optBoolean("milOn");
            report.reportedDtcCount = object.optInt("reportedDtcCount", -1);
            JSONArray readingArray = object.optJSONArray("readings");
            if (readingArray != null) {
                for (int i = 0; i < readingArray.length(); i++) {
                    JSONObject readingObject = readingArray.optJSONObject(i);
                    if (readingObject != null) {
                        Reading reading = Reading.fromJson(readingObject);
                        report.readings.put(reading.pid, reading);
                    }
                }
            }
            JSONArray dtcArray = object.optJSONArray("dtcs");
            if (dtcArray != null) {
                for (int i = 0; i < dtcArray.length(); i++) {
                    JSONObject dtcObject = dtcArray.optJSONObject(i);
                    if (dtcObject != null) report.dtcs.add(Dtc.fromJson(dtcObject));
                }
            }
            JSONArray warningArray = object.optJSONArray("warnings");
            if (warningArray != null) {
                for (int i = 0; i < warningArray.length(); i++) report.warnings.add(warningArray.optString(i));
            }
            return report;
        }

        public String shareText() {
            StringBuilder text = new StringBuilder();
            text.append("فاحص كار — تقرير قراءة OBD-II\n");
            text.append("السيارة: ").append(vehicleName).append('\n');
            text.append("وقت الفحص: ").append(new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(new Date(timestamp))).append('\n');
            text.append("المحول: ").append(adapterName).append('\n');
            text.append("البروتوكول: ").append(protocol).append('\n');
            text.append("VIN من وحدة التحكم: ").append(ecuVin.isEmpty() ? "لم يرد" : ecuVin).append('\n');
            text.append("لمبة MIL: ").append(!milStatusKnown ? "غير متاحة" : (milOn ? "مضاءة" : "غير مضاءة")).append('\n');
            text.append("الأكواد المقروءة: ").append(dtcs.size()).append("\n\n");
            if (dtcs.isEmpty()) text.append("لم ترسل وحدة التحكم أكواداً في أوضاع القراءة التي جُرّبت.\n");
            for (Dtc dtc : dtcs) {
                text.append(dtc.code).append(" — ").append(dtc.title).append('\n');
                text.append("الحالة: ").append(join(dtc.statuses, "، ")).append('\n');
            }
            text.append("\nالقراءات المتاحة من وحدة التحكم:\n");
            for (Reading reading : readings.values()) {
                text.append(reading.name).append(": ").append(reading.value);
                if (!reading.unit.isEmpty()) text.append(' ').append(reading.unit);
                text.append(" [PID ").append(String.format(Locale.US, "%02X", reading.pid)).append("]\n");
            }
            text.append("\nهذا تقرير OBD-II عام للمحرك/الانبعاثات. لا يؤكد تلف قطعة ولا يغطي بالضرورة ABS/SRS/ناقل الحركة. يلزم فحص فني مناسب.");
            return text.toString();
        }
    }

    private static final class PidSpec {
        final int pid;
        final String name;
        final String unit;
        PidSpec(int pid, String name, String unit) {
            this.pid = pid;
            this.name = name;
            this.unit = unit;
        }
    }

    private static final PidSpec[] PIDS = new PidSpec[] {
            new PidSpec(0x0C, "دوران المحرك", "د/د"),
            new PidSpec(0x0D, "سرعة السيارة", "كم/س"),
            new PidSpec(0x04, "حمل المحرك المحسوب", "%"),
            new PidSpec(0x11, "موضع الخانق", "%"),
            new PidSpec(0x0E, "تقديم التوقيت", "°"),
            new PidSpec(0x05, "حرارة سائل التبريد", "°م"),
            new PidSpec(0x0F, "حرارة هواء السحب", "°م"),
            new PidSpec(0x5C, "حرارة زيت المحرك", "°م"),
            new PidSpec(0x2F, "مستوى الوقود", "%"),
            new PidSpec(0x0A, "ضغط الوقود", "ك.باسكال"),
            new PidSpec(0x06, "تصحيح الوقود قصير المدى — البنك 1", "%"),
            new PidSpec(0x07, "تصحيح الوقود طويل المدى — البنك 1", "%"),
            new PidSpec(0x10, "تدفق الهواء MAF", "غ/ث"),
            new PidSpec(0x0B, "ضغط مجمع السحب", "ك.باسكال"),
            new PidSpec(0x42, "جهد وحدة التحكم", "فولت"),
            new PidSpec(0x14, "جهد حساس الأكسجين B1S1", "فولت"),
            new PidSpec(0x1F, "زمن تشغيل المحرك", "ث"),
            new PidSpec(0x21, "المسافة منذ إضاءة MIL", "كم"),
            new PidSpec(0x33, "الضغط الجوي", "ك.باسكال")
    };

    private ObdDiagnostics() { }

    public static ScanReport scan(ObdElm327 client, Vehicle vehicle, ProgressListener listener) throws IOException {
        if (client == null || !client.isConnected()) throw new IOException("اتصل بمحول ELM327 أولاً.");
        ScanReport report = new ScanReport();
        report.timestamp = System.currentTimeMillis();
        report.vehicleId = vehicle.id;
        report.vehicleName = vehicle.displayName();
        report.vehicleVin = vehicle.vin;
        report.adapterName = client.getAdapterIdentity();

        progress(listener, "التحقق من استجابة وحدة التحكم وقراءة PIDs المدعومة…");
        String supportResponse = client.command("0100", 10000);
        Long mask0 = parseSupportMask(supportResponse, 0x00);
        if (mask0 == null) {
            throw new IOException("لم تصل استجابة OBD-II من وحدة التحكم على PID 0100. تأكد من تشغيل الإشعال وتوافق المحول والسيارة. لم يُنشأ تقرير وهمي.");
        }
        report.ecuResponded = true;
        Map<Integer, Long> masks = new LinkedHashMap<>();
        masks.put(0x00, mask0);
        if (pidSupported(mask0, 0x20)) {
            Long mask20 = querySupportMask(client, 0x20, report);
            if (mask20 != null) masks.put(0x20, mask20);
        }
        Long mask20 = masks.get(0x20);
        if (mask20 != null && pidSupported(mask20, 0x40)) {
            Long mask40 = querySupportMask(client, 0x40, report);
            if (mask40 != null) masks.put(0x40, mask40);
        }
        try {
            report.protocol = client.getProtocol();
        } catch (IOException e) {
            report.protocol = "لم يرد تعريف البروتوكول";
            report.warnings.add("تعذر قراءة وصف البروتوكول: " + shortError(e));
        }

        progress(listener, "قراءة حالة لمبة الأعطال MIL…");
        if (isPidSupported(masks, 0x01)) {
            try {
                EcuStatus status = parseEcuStatus(client.command("0101", 6000));
                if (status != null) {
                    report.milStatusKnown = true;
                    report.milOn = status.milOn;
                    report.reportedDtcCount = status.reportedDtcCount;
                } else {
                    report.warnings.add("لم تُرجع وحدة التحكم بيانات قابلة للقراءة من PID 0101.");
                }
            } catch (IOException e) {
                report.warnings.add("تعذر قراءة حالة MIL: " + shortError(e));
            }
        } else {
            report.warnings.add("وحدة التحكم لم تعلن دعم PID 0101 لحالة MIL.");
        }

        LinkedHashMap<String, Dtc> dtcMap = new LinkedHashMap<>();
        readDtcMode(client, "03", 0x43, "مخزّن", dtcMap, report);
        progress(listener, "قراءة الأكواد المعلقة…");
        readDtcMode(client, "07", 0x47, "معلّق", dtcMap, report);
        progress(listener, "قراءة الأكواد الدائمة إن كانت مدعومة…");
        readDtcMode(client, "0A", 0x4A, "دائم", dtcMap, report);
        report.dtcs.addAll(dtcMap.values());

        progress(listener, "محاولة قراءة VIN من وحدة التحكم…");
        try {
            report.ecuVin = parseVin(client.command("0902", 7000));
            if (report.ecuVin.isEmpty()) report.warnings.add("لم ترسل وحدة التحكم VIN عبر Mode 09 PID 02.");
        } catch (IOException e) {
            report.warnings.add("تعذر قراءة VIN من وحدة التحكم: " + shortError(e));
        }

        progress(listener, "قراءة الحساسات التي أعلنت وحدة التحكم دعمها…");
        for (PidSpec spec : PIDS) {
            if (!isPidSupported(masks, spec.pid)) continue;
            try {
                String response = client.command(String.format(Locale.US, "01%02X", spec.pid), 3500);
                int[] payload = responsePayload(response, 0x41, spec.pid);
                if (payload == null) continue;
                Reading reading = decodePid(spec.pid, payload);
                if (reading != null) report.readings.put(spec.pid, reading);
            } catch (IOException e) {
                if (!client.isConnected()) throw new IOException("انقطع اتصال المحول أثناء قراءة PID " + String.format(Locale.US, "%02X", spec.pid) + ".", e);
                report.warnings.add("تعذر قراءة PID " + String.format(Locale.US, "%02X", spec.pid) + ": " + shortError(e));
            }
        }

        progress(listener, "اكتمل جمع البيانات التي أرسلتها السيارة.");
        return report;
    }

    private static Long querySupportMask(ObdElm327 client, int page, ScanReport report) {
        String command = String.format(Locale.US, "01%02X", page);
        try {
            return parseSupportMask(client.command(command, 6000), page);
        } catch (IOException e) {
            report.warnings.add("لم ترد وحدة التحكم على صفحة PIDs " + String.format(Locale.US, "%02X", page) + ".");
            return null;
        }
    }

    private static boolean isPidSupported(Map<Integer, Long> masks, int pid) {
        int page = ((pid - 1) / 32) * 32;
        Long mask = masks.get(page);
        return mask != null && pidSupported(mask, pid - page);
    }

    /** A PID support response is a 32-bit mask for PIDs 1..32 after the requested page. */
    static Long parseSupportMask(String response, int page) {
        int[] data = responsePayload(response, 0x41, page);
        if (data == null || data.length < 4) return null;
        return ((long) data[0] << 24) | ((long) data[1] << 16) | ((long) data[2] << 8) | (long) data[3];
    }

    /** The boundary PID (20/40/60...) is bit zero and indicates another page exists. */
    static boolean pidSupported(long mask, int pidWithinPage) {
        if (pidWithinPage < 1 || pidWithinPage > 32) return false;
        int bit = 32 - pidWithinPage;
        return (mask & (1L << bit)) != 0L;
    }

    public static EcuStatus parseEcuStatus(String response) {
        int[] data = responsePayload(response, 0x41, 0x01);
        if (data == null || data.length < 1) return null;
        return new EcuStatus((data[0] & 0x80) != 0, data[0] & 0x7F);
    }

    public static List<String> parseDtcCodes(String response, int responseService) {
        int[] data = responsePayload(response, responseService, null);
        if (data == null || data.length < 2) return Collections.emptyList();
        List<String> codes = new ArrayList<>();
        for (int i = 0; i + 1 < data.length;) {
            // Some ELM adapters concatenate answers from multiple ECUs. A repeated
            // service byte between complete DTC pairs makes the payload odd-length;
            // skip that boundary without changing normal DTC bytes.
            if (i > 0 && (data[i] & 0xFF) == responseService && ((data.length - i) & 1) == 1) {
                i++;
                continue;
            }
            int a = data[i] & 0xFF;
            int b = data[i + 1] & 0xFF;
            i += 2;
            if ((a == 0 && b == 0) || (a == 0xFF && b == 0xFF)) continue;
            char family;
            switch ((a >> 6) & 0x03) {
                case 0: family = 'P'; break;
                case 1: family = 'C'; break;
                case 2: family = 'B'; break;
                default: family = 'U'; break;
            }
            int firstDigit = (a >> 4) & 0x03;
            int secondDigit = a & 0x0F;
            int thirdDigit = (b >> 4) & 0x0F;
            int fourthDigit = b & 0x0F;
            String code = String.format(Locale.US, "%c%d%X%X%X", family, firstDigit, secondDigit, thirdDigit, fourthDigit);
            if (!codes.contains(code)) codes.add(code);
        }
        return codes;
    }

    private static void readDtcMode(ObdElm327 client, String command, int service, String status,
                                    Map<String, Dtc> collected, ScanReport report) throws IOException {
        try {
            String response = client.command(command, 7000);
            for (String code : parseDtcCodes(response, service)) {
                Dtc dtc = collected.get(code);
                if (dtc == null) {
                    dtc = new Dtc(code);
                    collected.put(code, dtc);
                }
                if (!dtc.statuses.contains(status)) dtc.statuses.add(status);
            }
        } catch (IOException e) {
            if (!client.isConnected()) throw new IOException("انقطع اتصال المحول أثناء قراءة الأكواد.", e);
            report.warnings.add("تعذر قراءة الأكواد " + status + " (Mode " + command + "): " + shortError(e));
        }
    }

    public static Reading decodePid(int pid, int[] bytes) {
        if (bytes == null || bytes.length == 0) return null;
        PidSpec spec = findSpec(pid);
        if (spec == null) return null;
        double value;
        int decimals = 0;
        switch (pid) {
            case 0x04: value = (bytes[0] & 0xFF) * 100.0 / 255.0; decimals = 1; break;
            case 0x05: value = (bytes[0] & 0xFF) - 40.0; break;
            case 0x06:
            case 0x07:
                value = ((bytes[0] & 0xFF) - 128.0) * 100.0 / 128.0; decimals = 1; break;
            case 0x0A: value = (bytes[0] & 0xFF) * 3.0; break;
            case 0x0B: value = bytes[0] & 0xFF; break;
            case 0x0C:
                if (bytes.length < 2) return null;
                value = (((bytes[0] & 0xFF) * 256.0) + (bytes[1] & 0xFF)) / 4.0; break;
            case 0x0D: value = bytes[0] & 0xFF; break;
            case 0x0E: value = (bytes[0] & 0xFF) / 2.0 - 64.0; decimals = 1; break;
            case 0x0F: value = (bytes[0] & 0xFF) - 40.0; break;
            case 0x10:
                if (bytes.length < 2) return null;
                value = (((bytes[0] & 0xFF) * 256.0) + (bytes[1] & 0xFF)) / 100.0; decimals = 2; break;
            case 0x11: value = (bytes[0] & 0xFF) * 100.0 / 255.0; decimals = 1; break;
            case 0x14: value = (bytes[0] & 0xFF) / 200.0; decimals = 3; break;
            case 0x1F:
            case 0x21:
            case 0x42:
                if (bytes.length < 2) return null;
                int word = ((bytes[0] & 0xFF) << 8) | (bytes[1] & 0xFF);
                if (pid == 0x42) { value = word / 1000.0; decimals = 2; }
                else value = word;
                break;
            case 0x2F: value = (bytes[0] & 0xFF) * 100.0 / 255.0; decimals = 1; break;
            case 0x33: value = bytes[0] & 0xFF; break;
            case 0x5C: value = (bytes[0] & 0xFF) - 40.0; break;
            default: return null;
        }
        String display = decimals == 0
                ? String.format(Locale.US, "%.0f", value)
                : String.format(Locale.US, "%1$." + decimals + "f", value);
        return new Reading(pid, spec.name, display, spec.unit, value);
    }

    public static Map<Integer, Reading> readLiveSnapshot(ObdElm327 client) throws IOException {
        if (client == null || !client.isConnected()) throw new IOException("اتصال المحول غير قائم.");
        int[] livePids = new int[] {0x0C, 0x0D, 0x05, 0x04, 0x42, 0x11};
        Map<Integer, Reading> readings = new LinkedHashMap<>();
        for (int pid : livePids) {
            String response = client.command(String.format(Locale.US, "01%02X", pid), 2500);
            int[] payload = responsePayload(response, 0x41, pid);
            Reading reading = decodePid(pid, payload);
            if (reading != null) readings.put(pid, reading);
        }
        return readings;
    }

    private static String parseVin(String response) {
        int[] payload = responsePayload(response, 0x49, 0x02);
        if (payload == null || payload.length == 0) return "";
        int start = payload[0] == 0x01 ? 1 : 0; // Mode 09 record number.
        StringBuilder vin = new StringBuilder(17);
        for (int i = start; i < payload.length && vin.length() < 17; i++) {
            int value = payload[i] & 0xFF;
            char c = (char) value;
            if ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z')) vin.append(c);
        }
        return vin.length() == 17 ? vin.toString() : "";
    }

    private static int[] responsePayload(String raw, int service, Integer pid) {
        List<Integer> bytes = responseBytes(raw);
        for (int i = 0; i < bytes.size(); i++) {
            if ((bytes.get(i) & 0xFF) != service) continue;
            if (pid != null) {
                if (i + 1 >= bytes.size() || (bytes.get(i + 1) & 0xFF) != pid) continue;
                int start = i + 2;
                int[] result = new int[bytes.size() - start];
                for (int j = 0; j < result.length; j++) result[j] = bytes.get(start + j) & 0xFF;
                return result;
            }
            int start = i + 1;
            int[] result = new int[bytes.size() - start];
            for (int j = 0; j < result.length; j++) result[j] = bytes.get(start + j) & 0xFF;
            return result;
        }
        return null;
    }

    private static List<Integer> responseBytes(String raw) {
        List<Integer> result = new ArrayList<>();
        if (raw == null) return result;
        String[] lines = raw.replace('\r', '\n').split("\n");
        for (String originalLine : lines) {
            String line = originalLine.trim().replace(">", "").trim();
            if (line.isEmpty()) continue;
            String upper = line.toUpperCase(Locale.ROOT);
            if (upper.contains("SEARCHING") || upper.contains("NO DATA") || upper.contains("UNABLE TO CONNECT") ||
                    upper.contains("CAN ERROR") || upper.contains("BUS INIT") || upper.contains("STOPPED") ||
                    upper.contains("BUFFER FULL") || upper.equals("OK") || upper.equals("?")) continue;
            line = line.replaceFirst("^\\d+\\s*:\\s*", ""); // ELM multi-line frame index, e.g. "0: 49 ..."
            String[] tokens = line.trim().split("\\s+");
            List<Integer> lineBytes = new ArrayList<>();
            for (String token : tokens) {
                if (token.matches("(?i)[0-9a-f]{2}")) {
                    lineBytes.add(Integer.parseInt(token, 16));
                } else if (token.matches("(?i)[0-9a-f]{4,}" ) && token.length() % 2 == 0) {
                    for (int i = 0; i + 1 < token.length(); i += 2) {
                        lineBytes.add(Integer.parseInt(token.substring(i, i + 2), 16));
                    }
                } else if (token.matches("(?i)[0-9a-f]{3}")) {
                    // 11-bit CAN response identifier (e.g. 7E8); headers are normally disabled.
                    if (!lineBytes.isEmpty()) lineBytes.add(Integer.parseInt(token.substring(0, 2), 16));
                }
            }
            if (lineBytes.isEmpty()) continue;
            if (lineBytes.size() > 1) {
                int first = lineBytes.get(0) & 0xFF;
                if ((first & 0xF0) == 0x10) {
                    lineBytes.remove(0); // ISO-TP first-frame PCI
                    if (!lineBytes.isEmpty()) lineBytes.remove(0); // total payload length
                } else if ((first & 0xF0) == 0x20 || (first & 0xF0) == 0x30) {
                    lineBytes.remove(0); // ISO-TP consecutive/flow-control PCI
                } else if ((first & 0xF0) == 0x00 && first > 0 && first <= 8 && lineBytes.size() > first) {
                    lineBytes.remove(0); // ISO-TP single-frame length
                }
            }
            result.addAll(lineBytes);
        }
        return result;
    }

    private static PidSpec findSpec(int pid) {
        for (PidSpec spec : PIDS) if (spec.pid == pid) return spec;
        return null;
    }

    private static void progress(ProgressListener listener, String message) {
        if (listener != null) listener.onProgress(message);
    }

    private static String shortError(Exception e) {
        String message = e.getMessage();
        if (e instanceof SocketTimeoutException) return "انتهت المهلة";
        return message == null || message.trim().isEmpty() ? "لا توجد استجابة" : message;
    }

    private static String join(List<String> values, String separator) {
        StringBuilder builder = new StringBuilder();
        for (String value : values) {
            if (builder.length() > 0) builder.append(separator);
            builder.append(value);
        }
        return builder.toString();
    }
}
