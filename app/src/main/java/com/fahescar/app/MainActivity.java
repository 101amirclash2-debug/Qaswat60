package com.fahescar.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONException;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int PAGE_HOME = 0;
    private static final int PAGE_SCAN = 1;
    private static final int PAGE_LIVE = 2;
    private static final int PAGE_REPORTS = 3;
    private static final int PAGE_GARAGE = 4;
    private static final int REQUEST_BT_PERMISSION = 20;
    private static final int REQUEST_BT_ENABLE = 21;
    private static final String PREFS = "fahes_car_preferences";
    private static final String PREF_ACTIVE_VEHICLE = "active_vehicle_id";

    private static final int BG = Color.rgb(7, 17, 31);
    private static final int CARD = Color.rgb(15, 29, 46);
    private static final int CARD_ALT = Color.rgb(19, 38, 58);
    private static final int TEXT = Color.rgb(238, 244, 250);
    private static final int MUTED = Color.rgb(153, 173, 192);
    private static final int MINT = Color.rgb(86, 216, 177);
    private static final int BLUE = Color.rgb(97, 184, 236);
    private static final int AMBER = Color.rgb(245, 189, 91);
    private static final int RED = Color.rgb(247, 114, 114);

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();
    private final Map<Integer, TextView> liveValueViews = new java.util.LinkedHashMap<>();

    private VehicleStore store;
    private BluetoothAdapter bluetoothAdapter;
    private volatile ObdElm327 client;
    private volatile boolean connecting;
    private volatile boolean scanInProgress;
    private volatile boolean livePolling;
    private volatile boolean liveRequestActive;
    private boolean livePaused;
    private String bluetoothDeviceName = "";
    private String connectionMessage = "لم يتم الاتصال بمحول بعد";
    private String scanProgressMessage = "لم يبدأ الفحص. اختر سيارة ثم اتصل بمحول ELM327 حقيقي.";
    private String liveMessage = "تُعرض القراءات التي ترسلها وحدة التحكم فقط.";
    private Map<Integer, ObdDiagnostics.Reading> latestLiveReadings = Collections.emptyMap();
    private List<Vehicle> vehicles = new ArrayList<>();
    private long activeVehicleId = -1;
    private long openReportId = -1;
    private int currentPage = PAGE_HOME;

    private LinearLayout pageContent;
    private TextView headerStatus;
    private TextView scanProgressView;
    private TextView liveMessageView;
    private TextView liveToggleView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        store = new VehicleStore(this);
        try {
            bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();
        } catch (Throwable ignored) {
            bluetoothAdapter = null;
        }
        SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        activeVehicleId = preferences.getLong(PREF_ACTIVE_VEHICLE, -1);
        refreshVehicles();
        buildShell();
        renderPage();
    }

    private void buildShell() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.setBackgroundColor(BG);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        header.setPadding(dp(18), dp(14), dp(18), dp(12));
        TextView brand = text("فاحص كار", 21, TEXT, true);
        brand.setGravity(Gravity.RIGHT | Gravity.CENTER_VERTICAL);
        TextView brandSub = text("قارئ OBD-II مباشر", 11, MUTED, false);
        LinearLayout brandBox = new LinearLayout(this);
        brandBox.setOrientation(LinearLayout.VERTICAL);
        brandBox.setGravity(Gravity.RIGHT);
        brandBox.addView(brand);
        brandBox.addView(brandSub);
        header.addView(brandBox, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        headerStatus = text("● غير متصل", 12, MUTED, true);
        headerStatus.setGravity(Gravity.CENTER);
        headerStatus.setPadding(dp(10), dp(8), dp(10), dp(8));
        headerStatus.setBackground(rounded(CARD, 30));
        header.addView(headerStatus, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(header, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        pageContent = new LinearLayout(this);
        pageContent.setOrientation(LinearLayout.VERTICAL);
        pageContent.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        pageContent.setPadding(dp(16), dp(8), dp(16), dp(20));
        scroll.addView(pageContent, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        nav.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        nav.setGravity(Gravity.CENTER);
        nav.setBackgroundColor(Color.rgb(10, 22, 37));
        nav.setPadding(dp(4), dp(5), dp(4), dp(6));
        String[] labels = {"الرئيسية", "الفحص", "الحيّة", "التقارير", "الكراج"};
        String[] icons = {"⌂", "⌕", "◉", "▤", "▣"};
        for (int i = 0; i < labels.length; i++) {
            final int page = i == 0 ? PAGE_HOME : i == 1 ? PAGE_SCAN : i == 2 ? PAGE_LIVE : i == 3 ? PAGE_REPORTS : PAGE_GARAGE;
            LinearLayout item = new LinearLayout(this);
            item.setOrientation(LinearLayout.VERTICAL);
            item.setGravity(Gravity.CENTER);
            item.setPadding(dp(1), dp(5), dp(1), dp(3));
            TextView icon = text(icons[i], 18, MINT, true);
            icon.setGravity(Gravity.CENTER);
            TextView label = text(labels[i], 10, MUTED, false);
            label.setGravity(Gravity.CENTER);
            item.addView(icon);
            item.addView(label);
            item.setOnClickListener(v -> {
                openReportId = -1;
                currentPage = page;
                renderPage();
            });
            nav.addView(item, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        }
        root.addView(nav, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(root);
    }

    private void renderPage() {
        if (pageContent == null) return;
        if (currentPage != PAGE_LIVE) stopLivePolling();
        refreshVehicles();
        pageContent.removeAllViews();
        liveValueViews.clear();
        scanProgressView = null;
        liveMessageView = null;
        liveToggleView = null;
        updateHeaderStatus();
        switch (currentPage) {
            case PAGE_SCAN: renderScanPage(); break;
            case PAGE_LIVE: renderLivePage(); break;
            case PAGE_REPORTS: renderReportsPage(); break;
            case PAGE_GARAGE: renderGaragePage(); break;
            default: renderHomePage(); break;
        }
        if (currentPage == PAGE_LIVE && !livePaused && isAdapterConnected()) startLivePolling();
    }

    private void renderHomePage() {
        addText(pageContent, "مرحباً بك في فاحص كار", 23, TEXT, true, 0, 4);
        addText(pageContent, "قراءات من وحدة تحكم السيارة عبر محول ELM327 — لا توجد نتائج تجريبية أو تشخيصات مولّدة.", 14, MUTED, false, 0, 14);

        LinearLayout connectionCard = card();
        addText(connectionCard, "اتصال المحول", 16, TEXT, true, 0, 4);
        addText(connectionCard, isAdapterConnected() ? "المحول متصل فعلياً عبر Bluetooth SPP." : connectionMessage, 13,
                isAdapterConnected() ? MINT : MUTED, false, 0, 8);
        if (isAdapterConnected()) {
            addText(connectionCard, "الاسم: " + (bluetoothDeviceName.isEmpty() ? "ELM327" : bluetoothDeviceName), 13, TEXT, false, 0, 4);
            addButton(connectionCard, "قطع الاتصال", RED, this::disconnectAdapter);
        } else {
            addButton(connectionCard, connecting ? "جارٍ الاتصال بالمحول…" : "الاتصال بمحول مقترن", BLUE, this::onConnectPressed);
            addButton(connectionCard, "فتح إعدادات Bluetooth لإقران المحول", CARD_ALT, this::openBluetoothSettings);
        }
        addBlock(pageContent, connectionCard);

        LinearLayout vehicleCard = card();
        addText(vehicleCard, "السيارة المحددة", 16, TEXT, true, 0, 5);
        Vehicle vehicle = activeVehicle();
        if (vehicle == null) {
            addText(vehicleCard, "أضف سيارتك إلى الكراج لربط تقارير الفحص بها.", 14, MUTED, false, 0, 8);
            addButton(vehicleCard, "إضافة سيارة", MINT, () -> { currentPage = PAGE_GARAGE; renderPage(); showAddVehicleDialog(); });
        } else {
            addText(vehicleCard, vehicle.displayName(), 17, TEXT, true, 0, 3);
            addText(vehicleCard, "العداد المسجل: " + formatInteger(vehicle.mileage) + " كم" + (vehicle.vin.isEmpty() ? "" : " • VIN السيارة: " + vehicle.vin), 12, MUTED, false, 0, 8);
            addButton(vehicleCard, "تغيير السيارة", CARD_ALT, this::showVehiclePicker);
        }
        addButton(vehicleCard, "بدء فحص OBD-II حقيقي", MINT, () -> { currentPage = PAGE_SCAN; renderPage(); });
        addBlock(pageContent, vehicleCard);

        LinearLayout summary = row();
        addSummaryCard(summary, "سياراتي", String.valueOf(vehicles.size()), BLUE);
        addSummaryCard(summary, "تقارير محفوظة", String.valueOf(store.listScans().size()), MINT);
        addBlock(pageContent, summary);

        LinearLayout note = card();
        addText(note, "حدود الفحص العام", 15, AMBER, true, 0, 4);
        addText(note, "هذه النسخة تقرأ OBD-II للمحرك والانبعاثات. لا تعتبر فحصاً لـ ABS أو الوسائد الهوائية أو كل وحدات ناقل الحركة، ولا تؤكد سلامة السيارة. شرح رمز العطل إرشادي؛ التشخيص النهائي يحتاج فحصاً فنياً.", 13, MUTED, false, 0, 0);
        addBlock(pageContent, note);
    }

    private void renderScanPage() {
        addText(pageContent, "فحص وحدة التحكم", 23, TEXT, true, 0, 4);
        addText(pageContent, "يُرسل التطبيق أوامر OBD-II إلى المحول ويعرض فقط الردود الفعلية من السيارة. لا تُحفظ نتيجة إذا لم تستجب وحدة التحكم.", 14, MUTED, false, 0, 12);

        LinearLayout vehicleCard = card();
        addText(vehicleCard, "السيارة", 15, TEXT, true, 0, 5);
        Vehicle vehicle = activeVehicle();
        addText(vehicleCard, vehicle == null ? "لم تُحدد سيارة" : vehicle.displayName(), 16, vehicle == null ? AMBER : TEXT, true, 0, 4);
        if (vehicle != null) {
            addText(vehicleCard, "VIN المدخل: " + (vehicle.vin.isEmpty() ? "غير مدخل" : vehicle.vin), 12, MUTED, false, 0, 6);
        }
        addButton(vehicleCard, "اختيار سيارة من الكراج", CARD_ALT, this::showVehiclePicker);
        if (vehicles.isEmpty()) addButton(vehicleCard, "إضافة سيارة", BLUE, () -> { currentPage = PAGE_GARAGE; renderPage(); showAddVehicleDialog(); });
        addBlock(pageContent, vehicleCard);

        LinearLayout adapterCard = card();
        addText(adapterCard, "حالة الاتصال", 15, TEXT, true, 0, 5);
        addText(adapterCard, isAdapterConnected() ? "متصل بمحول " + (bluetoothDeviceName.isEmpty() ? "ELM327" : bluetoothDeviceName) + " — شغّل الإشعال قبل الفحص." : connectionMessage, 13,
                isAdapterConnected() ? MINT : MUTED, false, 0, 8);
        if (isAdapterConnected()) {
            addButton(adapterCard, "قطع الاتصال", CARD_ALT, this::disconnectAdapter);
        } else {
            addButton(adapterCard, connecting ? "جارٍ الاتصال…" : "الاتصال بمحول ELM327", BLUE, this::onConnectPressed);
        }
        addBlock(pageContent, adapterCard);

        LinearLayout scanCard = card();
        addText(scanCard, "الفحص القياسي", 15, TEXT, true, 0, 5);
        addText(scanCard, "سيقرأ MIL، والأكواد المخزنة/المعلقة/الدائمة، وVIN عند دعمه، وقراءات PID المتاحة. لا يمسح الأكواد.", 13, MUTED, false, 0, 8);
        addButton(scanCard, scanInProgress ? "الفحص جارٍ…" : "ابدأ الفحص الفعلي", MINT, this::startScan);
        scanProgressView = text(scanProgressMessage, 13, MUTED, false);
        scanProgressView.setGravity(Gravity.RIGHT);
        scanProgressView.setPadding(0, dp(12), 0, dp(4));
        scanCard.addView(scanProgressView);
        addBlock(pageContent, scanCard);
    }

    private void renderLivePage() {
        addText(pageContent, "البيانات الحية", 23, TEXT, true, 0, 4);
        addText(pageContent, "قراءات PID مباشرة من ECU. لا يجري استبدال القيم المفقودة بأرقام تقديرية.", 14, MUTED, false, 0, 12);
        if (!isAdapterConnected()) {
            LinearLayout connectCard = card();
            addText(connectCard, "المحول غير متصل", 16, AMBER, true, 0, 5);
            addText(connectCard, "اقرن محول ELM327 Classic من إعدادات Bluetooth، ثم اتصل به هنا.", 13, MUTED, false, 0, 8);
            addButton(connectCard, "الاتصال بالمحول", BLUE, this::onConnectPressed);
            addBlock(pageContent, connectCard);
            return;
        }

        LinearLayout controls = row();
        TextView liveHint = text("تحديث دوري عند بقاء هذه الشاشة مفتوحة", 12, MUTED, false);
        controls.addView(liveHint, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        liveToggleView = text(livePaused ? "استئناف" : "إيقاف مؤقت", 12, TEXT, true);
        liveToggleView.setGravity(Gravity.CENTER);
        liveToggleView.setPadding(dp(12), dp(9), dp(12), dp(9));
        liveToggleView.setBackground(rounded(CARD_ALT, 14));
        liveToggleView.setOnClickListener(v -> toggleLivePolling());
        controls.addView(liveToggleView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        addBlock(pageContent, controls);

        LinearLayout readingsCard = card();
        addText(readingsCard, "القياسات المرسلة", 15, TEXT, true, 0, 6);
        addLiveReadingRow(readingsCard, 0x0C, "دوران المحرك", "د/د");
        addLiveReadingRow(readingsCard, 0x0D, "سرعة السيارة", "كم/س");
        addLiveReadingRow(readingsCard, 0x05, "حرارة سائل التبريد", "°م");
        addLiveReadingRow(readingsCard, 0x04, "حمل المحرك", "%");
        addLiveReadingRow(readingsCard, 0x42, "جهد وحدة التحكم", "فولت");
        addLiveReadingRow(readingsCard, 0x11, "موضع الخانق", "%");
        liveMessageView = text(liveMessage, 12, MUTED, false);
        liveMessageView.setPadding(0, dp(10), 0, dp(3));
        readingsCard.addView(liveMessageView);
        addBlock(pageContent, readingsCard);

        LinearLayout safetyCard = card();
        addText(safetyCard, "تنبيه", 14, AMBER, true, 0, 3);
        addText(safetyCard, "هذه قراءات عامة من OBD-II وليست توصية للقيادة. راقب الشاشة والسيارة متوقفة فقط.", 12, MUTED, false, 0, 0);
        addBlock(pageContent, safetyCard);
    }

    private void renderReportsPage() {
        if (openReportId > 0) {
            renderReportDetail(openReportId);
            return;
        }
        addText(pageContent, "تقارير الفحص", 23, TEXT, true, 0, 4);
        addText(pageContent, "محفوظة محلياً على هذا الهاتف؛ لا تُنشأ تقارير إلا بعد استجابة وحدة التحكم.", 14, MUTED, false, 0, 12);
        List<VehicleStore.ScanSummary> reports = store.listScans();
        if (reports.isEmpty()) {
            LinearLayout empty = card();
            addText(empty, "لا توجد تقارير بعد", 16, TEXT, true, 0, 5);
            addText(empty, "بعد توصيل المحول وتشغيل فحص فعلي، سيظهر التقرير هنا.", 13, MUTED, false, 0, 0);
            addBlock(pageContent, empty);
            return;
        }
        for (VehicleStore.ScanSummary summary : reports) {
            LinearLayout reportCard = card();
            addText(reportCard, formatDate(summary.timestamp), 11, MUTED, false, 0, 3);
            addText(reportCard, summary.vehicleName + (summary.modelLabel.isEmpty() ? "" : " — " + summary.modelLabel), 15, TEXT, true, 0, 4);
            String state = !summary.milKnown ? "حالة MIL غير متاحة" : (summary.milOn ? "لمبة MIL مضاءة" : "MIL غير مضاءة");
            if (summary.codeCount > 0) state += " • " + summary.codeCount + " كود";
            addText(reportCard, state, 12, summary.milKnown && summary.milOn ? RED : (summary.codeCount > 0 ? AMBER : MUTED), false, 0, 8);
            addButton(reportCard, "فتح التقرير", CARD_ALT, () -> { openReportId = summary.id; renderPage(); });
            addBlock(pageContent, reportCard);
        }
    }

    private void renderReportDetail(long reportId) {
        String json = store.getScanJson(reportId);
        if (json == null) {
            addText(pageContent, "لم يتم العثور على التقرير.", 16, AMBER, true, 0, 10);
            addButton(pageContent, "عودة", CARD_ALT, () -> { openReportId = -1; renderPage(); });
            return;
        }
        ObdDiagnostics.ScanReport report;
        try {
            report = ObdDiagnostics.ScanReport.fromJson(json);
        } catch (JSONException e) {
            addText(pageContent, "تعذر قراءة بيانات التقرير المحلي.", 16, RED, true, 0, 10);
            addButton(pageContent, "عودة", CARD_ALT, () -> { openReportId = -1; renderPage(); });
            return;
        }
        addButton(pageContent, "‹ العودة إلى التقارير", CARD_ALT, () -> { openReportId = -1; renderPage(); });
        addText(pageContent, "تقرير OBD-II", 22, TEXT, true, 0, 5);
        addText(pageContent, report.vehicleName + " • " + formatDate(report.timestamp), 13, MUTED, false, 0, 12);

        LinearLayout summary = card();
        addText(summary, "مصدر التقرير", 15, TEXT, true, 0, 5);
        addText(summary, "المحول: " + report.adapterName, 13, TEXT, false, 0, 3);
        addText(summary, "البروتوكول: " + (report.protocol.isEmpty() ? "غير متاح" : report.protocol), 13, TEXT, false, 0, 3);
        addText(summary, "VIN من ECU: " + (report.ecuVin.isEmpty() ? "لم يرد" : report.ecuVin), 13, TEXT, false, 0, 3);
        addText(summary, "VIN المسجل للسيارة: " + (report.vehicleVin.isEmpty() ? "غير مدخل" : report.vehicleVin), 13, MUTED, false, 0, 3);
        String mil = !report.milStatusKnown ? "غير متاح من ECU" : (report.milOn ? "مضاءة" : "غير مضاءة");
        addText(summary, "لمبة MIL: " + mil, 13, report.milOn ? RED : TEXT, true, 0, 3);
        addText(summary, "عدد الأكواد في PID 01: " + (report.reportedDtcCount < 0 ? "غير متاح" : String.valueOf(report.reportedDtcCount)), 13, TEXT, false, 0, 3);
        addText(summary, "عدد الرموز المقروءة: " + report.dtcs.size(), 13, TEXT, false, 0, 0);
        addBlock(pageContent, summary);

        LinearLayout dtcCard = card();
        addText(dtcCard, "رموز الأعطال المقروءة", 15, TEXT, true, 0, 7);
        if (report.dtcs.isEmpty()) {
            addText(dtcCard, "لم ترسل وحدة التحكم رموزاً في أوضاع القراءة المجربة. هذا لا يثبت خلو الأنظمة الأخرى من الأعطال.", 13, MUTED, false, 0, 0);
        } else {
            for (ObdDiagnostics.Dtc dtc : report.dtcs) {
                LinearLayout item = new LinearLayout(this);
                item.setOrientation(LinearLayout.VERTICAL);
                item.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
                item.setPadding(0, dp(8), 0, dp(8));
                TextView code = text(dtc.code + "   •   " + join(dtc.statuses, "، "), 14, AMBER, true);
                code.setTextDirection(View.TEXT_DIRECTION_LTR);
                code.setGravity(Gravity.RIGHT);
                item.addView(code);
                addText(item, dtc.title, 14, TEXT, true, 0, 3);
                addText(item, dtc.explanation, 12, MUTED, false, 0, 0);
                dtcCard.addView(item);
                if (dtc != report.dtcs.get(report.dtcs.size() - 1)) addDivider(dtcCard);
            }
        }
        addBlock(pageContent, dtcCard);

        LinearLayout readingCard = card();
        addText(readingCard, "الحساسات والبيانات المتاحة", 15, TEXT, true, 0, 7);
        if (report.readings.isEmpty()) {
            addText(readingCard, "لم تُرجع وحدة التحكم قيماً قابلة للقراءة ضمن مجموعة PIDs المطلوبة.", 13, MUTED, false, 0, 0);
        } else {
            for (ObdDiagnostics.Reading reading : report.readings.values()) {
                addKeyValue(readingCard, reading.name, reading.value + (reading.unit.isEmpty() ? "" : " " + reading.unit), MUTED, TEXT);
            }
        }
        addBlock(pageContent, readingCard);

        if (!report.warnings.isEmpty()) {
            LinearLayout warningCard = card();
            addText(warningCard, "ملاحظات الاستجابة", 14, AMBER, true, 0, 5);
            for (String warning : report.warnings) addText(warningCard, "• " + warning, 12, MUTED, false, 0, 4);
            addBlock(pageContent, warningCard);
        }

        LinearLayout limitation = card();
        addText(limitation, "قراءة وليست تشخيصاً نهائياً", 14, AMBER, true, 0, 4);
        addText(limitation, "تم تسجيل ردود OBD-II التي أرسلتها وحدة التحكم. شرح الكود عام وإرشادي، وقد لا تشمل هذه الواجهة وحدات ABS/SRS/ناقل الحركة الخاصة بالمصنّع. لا تعتبر نتيجة بلا أكواد شهادة سلامة.", 12, MUTED, false, 0, 0);
        addBlock(pageContent, limitation);
        addButton(pageContent, "مشاركة ملخص التقرير", MINT, () -> shareReport(report));
    }

    private void renderGaragePage() {
        addText(pageContent, "كراج السيارات", 23, TEXT, true, 0, 4);
        addText(pageContent, "أضف المركبات التي تريد ربط تقاريرها. بيانات السيارة لا تولّد نتيجة فحص.", 14, MUTED, false, 0, 12);
        addButton(pageContent, "＋ إضافة سيارة", MINT, this::showAddVehicleDialog);
        if (vehicles.isEmpty()) {
            LinearLayout empty = card();
            addText(empty, "الكراج فارغ", 16, TEXT, true, 0, 5);
            addText(empty, "أدخل بيانات السيارة يدوياً. لن تُضاف سيارات أو نتائج افتراضية.", 13, MUTED, false, 0, 0);
            addBlock(pageContent, empty);
            return;
        }
        for (Vehicle vehicle : vehicles) {
            LinearLayout vehicleCard = card();
            addText(vehicleCard, vehicle.displayName(), 16, TEXT, true, 0, 4);
            addText(vehicleCard, "العداد: " + formatInteger(vehicle.mileage) + " كم", 12, MUTED, false, 0, 3);
            addText(vehicleCard, "VIN: " + (vehicle.vin.isEmpty() ? "غير مدخل" : vehicle.vin), 12, MUTED, false, 0, 8);
            if (vehicle.id == activeVehicleId) {
                addText(vehicleCard, "السيارة المحددة للفحص", 12, MINT, true, 0, 6);
            } else {
                addButton(vehicleCard, "تحديد هذه السيارة", CARD_ALT, () -> selectVehicle(vehicle.id));
            }
            addBlock(pageContent, vehicleCard);
        }
    }

    private void addLiveReadingRow(LinearLayout parent, int pid, String label, String unit) {
        LinearLayout line = new LinearLayout(this);
        line.setOrientation(LinearLayout.HORIZONTAL);
        line.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        line.setGravity(Gravity.CENTER_VERTICAL);
        line.setPadding(0, dp(8), 0, dp(8));
        TextView title = text(label, 13, MUTED, false);
        TextView value = text("— " + unit, 14, TEXT, true);
        value.setGravity(Gravity.LEFT | Gravity.CENTER_VERTICAL);
        line.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        line.addView(value, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        parent.addView(line);
        addDivider(parent);
        liveValueViews.put(pid, value);
        ObdDiagnostics.Reading cached = latestLiveReadings.get(pid);
        if (cached != null) value.setText(cached.value + (cached.unit.isEmpty() ? "" : " " + cached.unit));
    }

    private void addSummaryCard(LinearLayout parent, String label, String value, int valueColor) {
        LinearLayout item = card();
        item.setBackground(rounded(CARD, 18));
        addText(item, label, 12, MUTED, false, 0, 5);
        addText(item, value, 24, valueColor, true, 0, 0);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        params.setMargins(dp(4), 0, dp(4), 0);
        parent.addView(item, params);
    }

    private void addKeyValue(LinearLayout parent, String key, String value, int keyColor, int valueColor) {
        LinearLayout line = new LinearLayout(this);
        line.setOrientation(LinearLayout.HORIZONTAL);
        line.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        line.setGravity(Gravity.CENTER_VERTICAL);
        line.setPadding(0, dp(8), 0, dp(8));
        TextView left = text(key, 12, keyColor, false);
        TextView right = text(value, 13, valueColor, true);
        right.setGravity(Gravity.LEFT | Gravity.CENTER_VERTICAL);
        line.addView(left, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        line.addView(right, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        parent.addView(line);
        addDivider(parent);
    }

    private void addDivider(LinearLayout parent) {
        View line = new View(this);
        line.setBackgroundColor(Color.rgb(35, 52, 70));
        parent.addView(line, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
    }

    private void addText(LinearLayout parent, String value, int size, int color, boolean bold, int top, int bottom) {
        TextView view = text(value, size, color, bold);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(top);
        params.bottomMargin = dp(bottom);
        parent.addView(view, params);
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setGravity(Gravity.RIGHT | Gravity.CENTER_VERTICAL);
        view.setTextDirection(View.TEXT_DIRECTION_RTL);
        view.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL));
        view.setIncludeFontPadding(true);
        return view;
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        card.setPadding(dp(16), dp(15), dp(16), dp(15));
        card.setBackground(rounded(CARD, 20));
        return card;
    }

    private LinearLayout row() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        return row;
    }

    private void addBlock(LinearLayout parent, View child) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.bottomMargin = dp(12);
        parent.addView(child, params);
    }

    private void addButton(LinearLayout parent, String label, int color, Runnable action) {
        TextView button = text(label, 14, (color == MINT || color == BLUE) ? Color.rgb(4, 20, 29) : TEXT, true);
        button.setGravity(Gravity.CENTER);
        button.setMinHeight(dp(46));
        button.setPadding(dp(14), dp(10), dp(14), dp(10));
        button.setBackground(rounded(color, 15));
        button.setClickable(true);
        button.setFocusable(true);
        button.setOnClickListener(v -> action.run());
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(8);
        parent.addView(button, params);
    }

    private GradientDrawable rounded(int color, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void updateHeaderStatus() {
        if (headerStatus == null) return;
        if (isAdapterConnected()) {
            headerStatus.setText("● متصل");
            headerStatus.setTextColor(MINT);
            headerStatus.setBackground(rounded(Color.rgb(19, 55, 52), 30));
        } else if (connecting) {
            headerStatus.setText("● جارٍ الاتصال");
            headerStatus.setTextColor(BLUE);
            headerStatus.setBackground(rounded(CARD_ALT, 30));
        } else {
            headerStatus.setText("● غير متصل");
            headerStatus.setTextColor(MUTED);
            headerStatus.setBackground(rounded(CARD, 30));
        }
    }

    private boolean isAdapterConnected() {
        ObdElm327 current = client;
        return current != null && current.isConnected();
    }

    private Vehicle activeVehicle() {
        for (Vehicle vehicle : vehicles) if (vehicle.id == activeVehicleId) return vehicle;
        return null;
    }

    private void refreshVehicles() {
        vehicles = store == null ? new ArrayList<>() : store.listVehicles();
        boolean activeExists = false;
        for (Vehicle vehicle : vehicles) if (vehicle.id == activeVehicleId) activeExists = true;
        if (!activeExists) {
            activeVehicleId = vehicles.isEmpty() ? -1 : vehicles.get(0).id;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putLong(PREF_ACTIVE_VEHICLE, activeVehicleId).apply();
        }
    }

    private void selectVehicle(long id) {
        activeVehicleId = id;
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putLong(PREF_ACTIVE_VEHICLE, id).apply();
        Toast.makeText(this, "تم تحديد السيارة للفحوصات القادمة", Toast.LENGTH_SHORT).show();
        renderPage();
    }

    private void showVehiclePicker() {
        refreshVehicles();
        if (vehicles.isEmpty()) {
            new AlertDialog.Builder(this)
                    .setTitle("الكراج فارغ")
                    .setMessage("أضف سيارة أولاً ثم ارجع إلى الفحص.")
                    .setPositiveButton("إضافة سيارة", (dialog, which) -> { currentPage = PAGE_GARAGE; renderPage(); showAddVehicleDialog(); })
                    .setNegativeButton("إلغاء", null)
                    .show();
            return;
        }
        String[] labels = new String[vehicles.size()];
        int checked = 0;
        for (int i = 0; i < vehicles.size(); i++) {
            Vehicle vehicle = vehicles.get(i);
            labels[i] = vehicle.displayName();
            if (vehicle.id == activeVehicleId) checked = i;
        }
        new AlertDialog.Builder(this)
                .setTitle("اختر السيارة")
                .setSingleChoiceItems(labels, checked, (dialog, which) -> {
                    long id = vehicles.get(which).id;
                    dialog.dismiss();
                    selectVehicle(id);
                })
                .setNegativeButton("إلغاء", null)
                .setNeutralButton("إضافة سيارة", (dialog, which) -> { currentPage = PAGE_GARAGE; renderPage(); showAddVehicleDialog(); })
                .show();
    }

    private void showAddVehicleDialog() {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        form.setPadding(dp(20), dp(8), dp(20), dp(4));
        EditText name = input("اسم مختصر للسيارة (مثال: سيارتي)", InputType.TYPE_CLASS_TEXT);
        EditText make = input("الشركة المصنعة", InputType.TYPE_CLASS_TEXT);
        EditText model = input("الطراز", InputType.TYPE_CLASS_TEXT);
        EditText year = input("سنة الصنع", InputType.TYPE_CLASS_NUMBER);
        EditText mileage = input("عداد الكيلومترات (اختياري)", InputType.TYPE_CLASS_NUMBER);
        EditText vin = input("VIN (اختياري)", InputType.TYPE_CLASS_TEXT);
        form.addView(name); form.addView(make); form.addView(model); form.addView(year); form.addView(mileage); form.addView(vin);
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("إضافة سيارة إلى الكراج")
                .setView(form)
                .setPositiveButton("حفظ", null)
                .setNegativeButton("إلغاء", null)
                .create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String nameValue = name.getText().toString().trim();
            String makeValue = make.getText().toString().trim();
            String modelValue = model.getText().toString().trim();
            int yearValue = parseInt(year.getText().toString(), 0);
            int mileageValue = parseInt(mileage.getText().toString(), 0);
            if (nameValue.isEmpty() || makeValue.isEmpty() || modelValue.isEmpty() || yearValue < 1950 || yearValue > 2100) {
                Toast.makeText(this, "أدخل الاسم والشركة والطراز وسنة صحيحة بين 1950 و2100", Toast.LENGTH_LONG).show();
                return;
            }
            Vehicle added = store.addVehicle(nameValue, makeValue, modelValue, yearValue, mileageValue, vin.getText().toString());
            activeVehicleId = added.id;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putLong(PREF_ACTIVE_VEHICLE, activeVehicleId).apply();
            dialog.dismiss();
            renderPage();
        }));
        dialog.show();
    }

    private EditText input(String hint, int type) {
        EditText edit = new EditText(this);
        edit.setSingleLine(true);
        edit.setTextSize(14);
        edit.setTextColor(TEXT);
        edit.setHintTextColor(MUTED);
        edit.setHint(hint);
        edit.setInputType(type);
        edit.setTextDirection(View.TEXT_DIRECTION_RTL);
        edit.setPadding(dp(8), dp(8), dp(8), dp(8));
        return edit;
    }

    private int parseInt(String value, int fallback) {
        try { return Integer.parseInt(value.trim()); } catch (Exception ignored) { return fallback; }
    }

    private void onConnectPressed() {
        if (connecting) return;
        if (bluetoothAdapter == null) {
            connectionMessage = "هذا الهاتف لا يوفّر Bluetooth Classic.";
            renderPage();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {Manifest.permission.BLUETOOTH_CONNECT}, REQUEST_BT_PERMISSION);
            return;
        }
        ensureBluetoothEnabledThenPick();
    }

    private void ensureBluetoothEnabledThenPick() {
        try {
            if (!bluetoothAdapter.isEnabled()) {
                startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), REQUEST_BT_ENABLE);
            } else {
                showPairedDevicePicker();
            }
        } catch (SecurityException e) {
            connectionMessage = "لم يُمنح إذن Bluetooth Connect.";
            renderPage();
        }
    }

    private void showPairedDevicePicker() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            onConnectPressed();
            return;
        }
        try {
            Set<BluetoothDevice> bonded = bluetoothAdapter.getBondedDevices();
            List<BluetoothDevice> devices = new ArrayList<>(bonded);
            Collections.sort(devices, (a, b) -> safeDeviceName(a).compareToIgnoreCase(safeDeviceName(b)));
            if (devices.isEmpty()) {
                new AlertDialog.Builder(this)
                        .setTitle("لا توجد أجهزة مقترنة")
                        .setMessage("اقرن محول ELM327 أولاً من إعدادات Bluetooth في الهاتف. قد يطلب رمز الاقتران المطبوع على المحول أو في دليله.")
                        .setPositiveButton("فتح إعدادات Bluetooth", (dialog, which) -> openBluetoothSettings())
                        .setNegativeButton("إلغاء", null)
                        .show();
                return;
            }
            String[] labels = new String[devices.size()];
            for (int i = 0; i < devices.size(); i++) {
                BluetoothDevice device = devices.get(i);
                labels[i] = safeDeviceName(device) + "\n" + device.getAddress();
            }
            new AlertDialog.Builder(this)
                    .setTitle("اختر محول ELM327 المقترن")
                    .setItems(labels, (dialog, which) -> connectToDevice(devices.get(which)))
                    .setNeutralButton("إقران جهاز جديد", (dialog, which) -> openBluetoothSettings())
                    .setNegativeButton("إلغاء", null)
                    .show();
        } catch (SecurityException e) {
            connectionMessage = "تعذر الوصول إلى أجهزة Bluetooth المقترنة. تحقق من إذن Bluetooth Connect.";
            renderPage();
        }
    }

    private String safeDeviceName(BluetoothDevice device) {
        try {
            String name = device.getName();
            return name == null || name.trim().isEmpty() ? "جهاز Bluetooth" : name;
        } catch (SecurityException e) {
            return "جهاز Bluetooth";
        }
    }

    private void connectToDevice(BluetoothDevice device) {
        if (connecting) return;
        connecting = true;
        connectionMessage = "جارٍ فتح قناة Bluetooth SPP والتحقق من رد المحول…";
        renderPage();
        ioExecutor.execute(() -> {
            ObdElm327 candidate = new ObdElm327();
            String name = "ELM327";
            try {
                name = safeDeviceName(device);
                String identity = candidate.connect(device);
                final String deviceName = name;
                final String adapterIdentity = identity;
                mainHandler.post(() -> {
                    client = candidate;
                    bluetoothDeviceName = deviceName;
                    connecting = false;
                    connectionMessage = "استجاب المحول: " + adapterIdentity + ". شغّل الإشعال قبل بدء الفحص.";
                    livePaused = false;
                    updateHeaderStatus();
                    renderPage();
                    Toast.makeText(this, "تم الاتصال بمحول " + adapterIdentity, Toast.LENGTH_LONG).show();
                });
            } catch (Exception e) {
                candidate.disconnect();
                String message = e.getMessage() == null ? "تعذر الاتصال بالمحول." : e.getMessage();
                mainHandler.post(() -> {
                    connecting = false;
                    connectionMessage = "فشل الاتصال: " + message;
                    updateHeaderStatus();
                    renderPage();
                });
            }
        });
    }

    private void disconnectAdapter() {
        stopLivePolling();
        ObdElm327 current = client;
        client = null;
        if (current != null) current.disconnect();
        bluetoothDeviceName = "";
        connectionMessage = "تم قطع اتصال المحول.";
        livePaused = false;
        updateHeaderStatus();
        renderPage();
    }

    private void openBluetoothSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS));
        } catch (Exception e) {
            Toast.makeText(this, "تعذر فتح إعدادات Bluetooth في هذا الهاتف.", Toast.LENGTH_SHORT).show();
        }
    }

    private void startScan() {
        if (scanInProgress) return;
        Vehicle vehicle = activeVehicle();
        if (vehicle == null) {
            new AlertDialog.Builder(this)
                    .setTitle("اختر سيارة أولاً")
                    .setMessage("يجب إضافة سيارة إلى الكراج لربط التقرير بها.")
                    .setPositiveButton("إضافة سيارة", (dialog, which) -> { currentPage = PAGE_GARAGE; renderPage(); showAddVehicleDialog(); })
                    .setNegativeButton("إلغاء", null)
                    .show();
            return;
        }
        if (!isAdapterConnected()) {
            Toast.makeText(this, "اتصل بمحول ELM327 الحقيقي أولاً.", Toast.LENGTH_LONG).show();
            onConnectPressed();
            return;
        }
        stopLivePolling();
        scanInProgress = true;
        scanProgressMessage = "يبدأ الآن الاستعلام من وحدة التحكم…";
        renderPage();
        ObdElm327 current = client;
        ioExecutor.execute(() -> {
            try {
                ObdDiagnostics.ScanReport report = ObdDiagnostics.scan(current, vehicle, message -> mainHandler.post(() -> {
                    scanProgressMessage = message;
                    if (currentPage == PAGE_SCAN && scanProgressView != null) scanProgressView.setText(message);
                }));
                long id = store.saveScan(report);
                report.id = id;
                mainHandler.post(() -> {
                    scanInProgress = false;
                    scanProgressMessage = "اكتمل الفحص وحُفظت الردود الفعلية.";
                    openReportId = report.id;
                    currentPage = PAGE_REPORTS;
                    renderPage();
                    Toast.makeText(this, "حُفظ تقرير OBD-II من رد وحدة التحكم", Toast.LENGTH_LONG).show();
                });
            } catch (Exception e) {
                String message = e.getMessage() == null ? "تعذر إكمال الفحص." : e.getMessage();
                mainHandler.post(() -> {
                    scanInProgress = false;
                    scanProgressMessage = "لم يُحفظ تقرير: " + message;
                    renderPage();
                });
            }
        });
    }

    private void startLivePolling() {
        if (livePaused || !isAdapterConnected() || livePolling) return;
        livePolling = true;
        requestLiveUpdate();
    }

    private void stopLivePolling() {
        livePolling = false;
        mainHandler.removeCallbacks(liveRefreshRunnable);
    }

    private final Runnable liveRefreshRunnable = this::requestLiveUpdate;

    private void toggleLivePolling() {
        livePaused = !livePaused;
        if (livePaused) {
            stopLivePolling();
            liveMessage = "التحديث متوقف مؤقتاً.";
        } else {
            liveMessage = "جارٍ طلب قراءات جديدة من وحدة التحكم…";
            startLivePolling();
        }
        if (liveToggleView != null) liveToggleView.setText(livePaused ? "استئناف" : "إيقاف مؤقت");
        if (liveMessageView != null) liveMessageView.setText(liveMessage);
    }

    private void requestLiveUpdate() {
        if (!livePolling || liveRequestActive || !isAdapterConnected()) return;
        liveRequestActive = true;
        ObdElm327 current = client;
        ioExecutor.execute(() -> {
            Map<Integer, ObdDiagnostics.Reading> result = null;
            String error = null;
            try {
                result = ObdDiagnostics.readLiveSnapshot(current);
            } catch (Exception e) {
                error = e.getMessage() == null ? "تعذر قراءة البيانات الحية." : e.getMessage();
            }
            final Map<Integer, ObdDiagnostics.Reading> readings = result;
            final String failure = error;
            mainHandler.post(() -> {
                liveRequestActive = false;
                if (readings != null) {
                    latestLiveReadings = readings;
                    liveMessage = readings.isEmpty()
                            ? "لم ترسل وحدة التحكم أياً من PIDs الحية المطلوبة؛ لم تُعرض قيم تقديرية."
                            : "آخر قراءة: " + formatDate(System.currentTimeMillis()) + " • القيم من ECU مباشرة.";
                    for (Map.Entry<Integer, TextView> entry : liveValueViews.entrySet()) {
                        ObdDiagnostics.Reading reading = readings.get(entry.getKey());
                        entry.getValue().setText(reading == null ? "— غير متاح" : reading.value + (reading.unit.isEmpty() ? "" : " " + reading.unit));
                    }
                } else {
                    liveMessage = "تعذر تحديث البيانات: " + failure;
                    if (!isAdapterConnected()) {
                        livePolling = false;
                        connectionMessage = "انقطع اتصال المحول أثناء قراءة البيانات.";
                        updateHeaderStatus();
                    }
                }
                if (liveMessageView != null) liveMessageView.setText(liveMessage);
                if (livePolling) mainHandler.postDelayed(liveRefreshRunnable, 2500L);
            });
        });
    }

    private void shareReport(ObdDiagnostics.ScanReport report) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_SUBJECT, "تقرير فحص OBD-II — فاحص كار");
        send.putExtra(Intent.EXTRA_TEXT, report.shareText());
        startActivity(Intent.createChooser(send, "مشاركة تقرير الفحص"));
    }

    private void onRequestBluetoothPermissionResult(boolean granted) {
        if (granted) ensureBluetoothEnabledThenPick();
        else {
            connectionMessage = "يلزم إذن Bluetooth Connect للاتصال بالمحول.";
            renderPage();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_BT_PERMISSION) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            onRequestBluetoothPermissionResult(granted);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_BT_ENABLE) {
            if (resultCode == Activity.RESULT_OK) showPairedDevicePicker();
            else {
                connectionMessage = "لم يتم تشغيل Bluetooth.";
                renderPage();
            }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (currentPage == PAGE_LIVE && !livePaused && isAdapterConnected()) startLivePolling();
    }

    @Override
    protected void onPause() {
        if (currentPage == PAGE_LIVE) stopLivePolling();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        stopLivePolling();
        ObdElm327 current = client;
        client = null;
        if (current != null) current.disconnect();
        if (store != null) store.close();
        ioExecutor.shutdownNow();
        super.onDestroy();
    }

    private static String formatDate(long timestamp) {
        if (timestamp <= 0) return "وقت غير معروف";
        return new SimpleDateFormat("yyyy/MM/dd — HH:mm", Locale.getDefault()).format(new Date(timestamp));
    }

    private static String formatInteger(int value) {
        return String.format(Locale.getDefault(), "%,d", value);
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
