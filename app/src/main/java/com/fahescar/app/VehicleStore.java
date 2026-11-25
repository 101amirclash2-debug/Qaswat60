package com.fahescar.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Local-only storage; no cloud, sample cars, or seeded diagnostic results. */
public final class VehicleStore extends SQLiteOpenHelper {
    private static final String DB_NAME = "fahes_car_local.db";
    private static final int DB_VERSION = 1;

    public static final class ScanSummary {
        public final long id;
        public final long vehicleId;
        public final long timestamp;
        public final String vehicleName;
        public final String modelLabel;
        public final boolean milKnown;
        public final boolean milOn;
        public final int codeCount;

        ScanSummary(long id, long vehicleId, long timestamp, String vehicleName, String modelLabel,
                    boolean milKnown, boolean milOn, int codeCount) {
            this.id = id;
            this.vehicleId = vehicleId;
            this.timestamp = timestamp;
            this.vehicleName = vehicleName;
            this.modelLabel = modelLabel;
            this.milKnown = milKnown;
            this.milOn = milOn;
            this.codeCount = codeCount;
        }
    }

    public VehicleStore(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onConfigure(SQLiteDatabase db) {
        super.onConfigure(db);
        db.setForeignKeyConstraintsEnabled(true);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE vehicles (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "name TEXT NOT NULL," +
                "make TEXT NOT NULL," +
                "model TEXT NOT NULL," +
                "year INTEGER NOT NULL," +
                "mileage INTEGER NOT NULL DEFAULT 0," +
                "vin TEXT NOT NULL DEFAULT '')");
        db.execSQL("CREATE TABLE scans (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "vehicle_id INTEGER NOT NULL," +
                "created_at INTEGER NOT NULL," +
                "details_json TEXT NOT NULL," +
                "FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE)");
        db.execSQL("CREATE INDEX scans_created_idx ON scans(created_at DESC)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Version 1 is the initial local schema. Future upgrades should preserve user data.
    }

    public synchronized List<Vehicle> listVehicles() {
        List<Vehicle> vehicles = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().query("vehicles",
                new String[] {"id", "name", "make", "model", "year", "mileage", "vin"},
                null, null, null, null, "name COLLATE NOCASE ASC")) {
            while (cursor.moveToNext()) {
                vehicles.add(new Vehicle(
                        cursor.getLong(0), cursor.getString(1), cursor.getString(2), cursor.getString(3),
                        cursor.getInt(4), cursor.getInt(5), cursor.getString(6)));
            }
        }
        return vehicles;
    }

    public synchronized Vehicle addVehicle(String name, String make, String model, int year, int mileage, String vin) {
        ContentValues values = new ContentValues();
        values.put("name", name.trim());
        values.put("make", make.trim());
        values.put("model", model.trim());
        values.put("year", year);
        values.put("mileage", Math.max(0, mileage));
        values.put("vin", vin == null ? "" : vin.trim().toUpperCase(java.util.Locale.ROOT));
        long id = getWritableDatabase().insertOrThrow("vehicles", null, values);
        return new Vehicle(id, name.trim(), make.trim(), model.trim(), year, Math.max(0, mileage), vin);
    }

    public synchronized long saveScan(ObdDiagnostics.ScanReport report) throws JSONException {
        ContentValues values = new ContentValues();
        values.put("vehicle_id", report.vehicleId);
        values.put("created_at", report.timestamp);
        values.put("details_json", report.toJson().toString());
        long id = getWritableDatabase().insertOrThrow("scans", null, values);
        report.id = id;
        ContentValues updated = new ContentValues();
        updated.put("details_json", report.toJson().toString());
        getWritableDatabase().update("scans", updated, "id=?", new String[] {String.valueOf(id)});
        return id;
    }

    public synchronized List<ScanSummary> listScans() {
        List<ScanSummary> summaries = new ArrayList<>();
        String query = "SELECT s.id, s.vehicle_id, s.created_at, s.details_json, " +
                "v.name, v.make, v.model, v.year " +
                "FROM scans s LEFT JOIN vehicles v ON v.id=s.vehicle_id " +
                "ORDER BY s.created_at DESC";
        try (Cursor cursor = getReadableDatabase().rawQuery(query, null)) {
            while (cursor.moveToNext()) {
                boolean milKnown = false;
                boolean milOn = false;
                int codes = 0;
                try {
                    JSONObject object = new JSONObject(cursor.getString(3));
                    milKnown = object.optBoolean("milStatusKnown");
                    milOn = object.optBoolean("milOn");
                    if (object.optJSONArray("dtcs") != null) codes = object.optJSONArray("dtcs").length();
                } catch (JSONException ignored) {
                    // A damaged row is still listed and can be reported as unreadable when opened.
                }
                String name = cursor.getString(4) == null ? "سيارة محذوفة" : cursor.getString(4);
                String make = cursor.getString(5) == null ? "" : cursor.getString(5);
                String model = cursor.getString(6) == null ? "" : cursor.getString(6);
                int year = cursor.getInt(7);
                String modelLabel = (make + " " + model + (year > 0 ? " " + year : "")).trim();
                summaries.add(new ScanSummary(cursor.getLong(0), cursor.getLong(1), cursor.getLong(2),
                        name, modelLabel, milKnown, milOn, codes));
            }
        }
        return summaries;
    }

    public synchronized String getScanJson(long id) {
        try (Cursor cursor = getReadableDatabase().query("scans", new String[] {"details_json"},
                "id=?", new String[] {String.valueOf(id)}, null, null, null, "1")) {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        }
    }
}
