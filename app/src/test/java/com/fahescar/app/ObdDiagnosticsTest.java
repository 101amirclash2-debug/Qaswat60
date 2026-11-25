package com.fahescar.app;

import org.junit.Test;
import java.util.List;

import static org.junit.Assert.*;

public class ObdDiagnosticsTest {
    @Test
    public void parsesConfirmedPendingAndPermanentDtcCodes() {
        assertEquals(List.of("P0133", "P0420"), ObdDiagnostics.parseDtcCodes("43 01 33 04 20", 0x43));
        assertEquals(List.of("P0301"), ObdDiagnostics.parseDtcCodes("47 03 01", 0x47));
        assertEquals(List.of("U0100"), ObdDiagnostics.parseDtcCodes("4A C1 00", 0x4A));
    }

    @Test
    public void handlesConcatenatedDtcResponsesFromMoreThanOneEcu() {
        assertEquals(List.of("P0133", "P0420"), ObdDiagnostics.parseDtcCodes("43 01 33 43 04 20", 0x43));
    }

    @Test
    public void ignoresNoDataAndZeroPaddingForDtcResponses() {
        assertTrue(ObdDiagnostics.parseDtcCodes("NO DATA", 0x43).isEmpty());
        assertTrue(ObdDiagnostics.parseDtcCodes("43 00 00 00 00", 0x43).isEmpty());
    }

    @Test
    public void decodesSupportMaskForPids() {
        long mask = 0xBE3EA812L;
        assertTrue(ObdDiagnostics.pidSupported(mask, 0x01));
        assertTrue(ObdDiagnostics.pidSupported(mask, 0x0C));
        assertFalse(ObdDiagnostics.pidSupported(mask, 0x20));
    }

    @Test
    public void readsLivePidValuesUsingStandardFormulas() {
        ObdDiagnostics.Reading rpm = ObdDiagnostics.decodePid(0x0C, new int[]{0x1A, 0xF8});
        assertNotNull(rpm);
        assertEquals("1726", rpm.value);
        assertEquals("د/د", rpm.unit);

        ObdDiagnostics.Reading coolant = ObdDiagnostics.decodePid(0x05, new int[]{0x7B});
        assertNotNull(coolant);
        assertEquals("83", coolant.value);
    }

    @Test
    public void decodesStatusFromModeOnePidOne() {
        ObdDiagnostics.EcuStatus status = ObdDiagnostics.parseEcuStatus("41 01 83 00 00 00");
        assertNotNull(status);
        assertTrue(status.milOn);
        assertEquals(3, status.reportedDtcCount);
    }
}
