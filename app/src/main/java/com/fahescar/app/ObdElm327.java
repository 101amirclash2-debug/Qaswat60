package com.fahescar.app;

import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Real RFCOMM/SPP transport for paired ELM327 adapters. */
public final class ObdElm327 {
    public static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int DEFAULT_TIMEOUT_MS = 3500;

    private final Object ioLock = new Object();
    private volatile BluetoothSocket socket;
    private volatile InputStream input;
    private volatile OutputStream output;
    private volatile String adapterIdentity = "ELM327";

    public String connect(BluetoothDevice device) throws IOException {
        disconnect();
        BluetoothSocket candidate = null;
        IOException secureFailure = null;
        try {
            candidate = device.createRfcommSocketToServiceRecord(SPP_UUID);
            candidate.connect();
        } catch (IOException first) {
            secureFailure = first;
            closeQuietly(candidate);
            candidate = null;
            try {
                candidate = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                candidate.connect();
            } catch (IOException second) {
                closeQuietly(candidate);
                second.addSuppressed(secureFailure);
                throw second;
            }
        }

        socket = candidate;
        input = candidate.getInputStream();
        output = candidate.getOutputStream();
        try {
            // A true ELM327 answers these commands; connection state is never faked.
            command("ATZ", 10000);
            command("ATE0", 2500);
            command("ATL0", 2500);
            command("ATS1", 2500);
            command("ATH0", 2500);
            command("ATSP0", 2500);
            command("ATAT2", 2500);
            String identity = command("ATI", DEFAULT_TIMEOUT_MS).trim();
            if (identity.isEmpty() || isErrorResponse(identity)) {
                throw new IOException("اتصل الهاتف بالجهاز، لكن المحول لم يعرّف نفسه كواجهة ELM327.");
            }
            adapterIdentity = firstUsefulLine(identity);
            return adapterIdentity;
        } catch (IOException e) {
            disconnect();
            throw e;
        }
    }

    public boolean isConnected() {
        BluetoothSocket current = socket;
        return current != null && current.isConnected();
    }

    public String getAdapterIdentity() {
        return adapterIdentity;
    }

    public String getProtocol() throws IOException {
        String response = command("ATDP", DEFAULT_TIMEOUT_MS);
        String line = firstUsefulLine(response);
        return line.isEmpty() ? "غير محدد قبل استجابة وحدة التحكم" : line;
    }

    public String command(String command) throws IOException {
        return command(command, DEFAULT_TIMEOUT_MS);
    }

    public String command(String command, int timeoutMs) throws IOException {
        synchronized (ioLock) {
            BluetoothSocket current = socket;
            InputStream in = input;
            OutputStream out = output;
            if (current == null || !current.isConnected() || in == null || out == null) {
                throw new IOException("اتصال Bluetooth غير قائم.");
            }
            drainAvailable(in);
            out.write((command.trim() + "\r").getBytes(StandardCharsets.US_ASCII));
            out.flush();

            StringBuilder response = new StringBuilder();
            long deadline = System.currentTimeMillis() + timeoutMs;
            while (System.currentTimeMillis() < deadline) {
                if (!current.isConnected()) throw new IOException("انقطع اتصال المحول.");
                int available = in.available();
                if (available > 0) {
                    for (int i = 0; i < available; i++) {
                        int value = in.read();
                        if (value < 0) throw new IOException("أغلق المحول اتصال Bluetooth.");
                        char ch = (char) value;
                        if (ch == '>') return response.toString();
                        if (ch != '\0') response.append(ch);
                    }
                } else {
                    try {
                        Thread.sleep(12L);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        throw new IOException("أُوقف انتظار استجابة المحول.", e);
                    }
                }
            }
            String partial = response.toString().trim();
            if (!partial.isEmpty()) {
                throw new SocketTimeoutException("انتهت مهلة استجابة المحول للأمر " + command + ". الرد الجزئي: " + partial);
            }
            throw new SocketTimeoutException("لم يرد محول ELM327 على الأمر " + command + " خلال المهلة المحددة.");
        }
    }

    public void disconnect() {
        // Close without waiting on the command lock so a user can cancel a blocked
        // ELM response immediately. The in-flight reader then exits with IOException.
        BluetoothSocket current = socket;
        socket = null;
        input = null;
        output = null;
        closeQuietly(current);
    }

    private static void drainAvailable(InputStream in) throws IOException {
        byte[] scratch = new byte[256];
        while (in.available() > 0) {
            int count = in.read(scratch, 0, Math.min(scratch.length, in.available()));
            if (count <= 0) break;
        }
    }

    private static boolean isErrorResponse(String response) {
        String upper = response.toUpperCase(java.util.Locale.ROOT);
        return upper.contains("UNABLE TO CONNECT") || upper.contains("NO DATA") ||
                upper.contains("CAN ERROR") || upper.contains("BUS INIT") ||
                upper.contains("ERROR") || upper.trim().equals("?");
    }

    private static String firstUsefulLine(String raw) {
        if (raw == null) return "";
        for (String line : raw.replace('\r', '\n').split("\n")) {
            String value = line.trim();
            if (value.isEmpty() || value.equalsIgnoreCase("OK") || value.equals("?")) continue;
            if (value.toUpperCase(java.util.Locale.ROOT).startsWith("SEARCHING")) continue;
            return value;
        }
        return "";
    }

    private static void closeQuietly(BluetoothSocket candidate) {
        if (candidate == null) return;
        try {
            candidate.close();
        } catch (IOException ignored) {
            // Best-effort close while recovering from a failed socket.
        }
    }
}
