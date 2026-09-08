# Ledgerly Attendance: Samsung Tablet Kiosk Provisioning

This guide turns the Samsung Galaxy Tab A7 Lite into a Ledgerly-only attendance kiosk. It does **not** require root or an unlocked bootloader.

## What has already been prepared

- Android package: `com.ledgerlyattendance`
- Device-admin receiver: `com.ledgerlyattendance/.LedgerlyDeviceAdminReceiver`
- Release APK: `android/app/build/outputs/apk/release/app-release.apk`
- The app enters Android lock-task (kiosk) mode once it becomes the device owner.
- The app starts after a device reboot.

## 1. On the freshly reset tablet

1. Turn the tablet on and complete the initial Android welcome screens.
2. Do **not** add a Google account, Samsung account, email account, WhatsApp account, or any other account.
3. Connect to Wi-Fi if needed, but skip restoring backups and installing apps.
4. Finish setup and open **Settings**.
5. Enable Developer options:
   - Open **About tablet** → **Software information**.
   - Tap **Build number** seven times.
   - Enter the screen/PIN if Android asks.
6. Open **Developer options** and enable **USB debugging**.
7. Connect the tablet to the computer by USB and accept the **Allow USB debugging?** prompt.

Do not add any account before the next section. Android only permits device-owner setup on an account-free device.

## 2. On the computer

From the `attendance-mobile` folder, confirm that ADB can see the device:

```bash
adb devices -l
```

It must say `device`, not `unauthorized`.

Install the prepared release APK:

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

If Android opens a Google Play Protect dialog, choose **Don't send** and continue the installation.

Assign Ledgerly as the tablet’s device owner:

```bash
adb shell dpm set-device-owner com.ledgerlyattendance/.LedgerlyDeviceAdminReceiver
```

Expected result:

```text
Success: Device owner set to package com.ledgerlyattendance
```

If it says accounts already exist, factory-reset the tablet again and repeat the setup without adding any accounts.

## 3. Start and verify kiosk mode

Launch Ledgerly:

```bash
adb shell monkey -p com.ledgerlyattendance -c android.intent.category.LAUNCHER 1
```

Verify ownership and kiosk allowlisting:

```bash
adb shell dpm list-owners
adb shell dumpsys device_policy | rg -i 'owner|lock task'
```

The expected owner is `com.ledgerlyattendance`. When Ledgerly opens, its kiosk screen calls Android lock-task mode, hiding Home, Recents, notifications, and other apps.

Restart the tablet once as a final check:

```bash
adb reboot
```

After boot, Ledgerly should launch automatically.

## 4. Enroll the Ledgerly kiosk

On the tablet, Ledgerly will show **Register this kiosk**. In the Ledgerly web app:

1. Open Attendance → Devices / Kiosks.
2. Create a kiosk enrollment QR code.
3. Scan it on the tablet.
4. Confirm that the kiosk shows its assigned name and online status.

## Administrator exit

The current app opens its administrator exit panel after five taps on the `ledgerly` logo. Enter the administrator exit PIN that was contained in the enrollment QR code.

## AI handoff instructions

If another AI continues this task, it should:

1. Never root, unlock the bootloader, or flash this tablet; Android device-owner kiosk mode is the intended solution.
2. First run `adb devices -l` and confirm this exact device is attached: `SM-T227U` / `gta7lite`.
3. Check for accounts before provisioning:

```bash
adb shell dumpsys account | rg 'Account \\{'
```

4. Do not factory-reset without the user’s clear approval. A reset deletes data and may trigger Factory Reset Protection if Google/Samsung accounts were not removed first.
5. Build only if the supplied APK is absent or source code changed:

```bash
npm run typecheck
android/gradlew -p android assembleRelease -PreactNativeArchitectures=arm64-v8a
```

6. Install the APK, then run exactly:

```bash
adb shell dpm set-device-owner com.ledgerlyattendance/.LedgerlyDeviceAdminReceiver
```

7. If it succeeds, launch the app and verify lock-task behavior. If it fails due to accounts, stop and ask the user to reset/complete setup without accounts.
