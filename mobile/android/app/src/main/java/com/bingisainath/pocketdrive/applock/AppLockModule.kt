package com.bingisainath.pocketdrive.applock

import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * App lock via the device's own authentication — fingerprint/face where available, falling back to
 * the PIN/pattern/password. Backed by AndroidX BiometricPrompt so JS just asks to authenticate and
 * gets a boolean back.
 */
class AppLockModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "PocketDriveAppLock"

  /** Device credentials (biometric or PIN/pattern/password) allowed for the current OS version. */
  private fun authenticators(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_WEAK

  /** Whether the device can actually authenticate the user (something is enrolled). */
  @ReactMethod
  fun canAuthenticate(promise: Promise) {
    val status = BiometricManager.from(reactContext).canAuthenticate(authenticators())
    promise.resolve(status == BiometricManager.BIOMETRIC_SUCCESS)
  }

  /** Show the system unlock prompt; resolves true on success, false if the user cancels/fails. */
  @ReactMethod
  fun authenticate(title: String, subtitle: String, promise: Promise) {
    val activity = reactContext.currentActivity as? FragmentActivity
    if (activity == null) {
      promise.reject("no_activity", "No foreground activity to show the unlock prompt")
      return
    }

    val allowed = authenticators()
    val builder = BiometricPrompt.PromptInfo.Builder()
      .setTitle(title)
      .setSubtitle(subtitle)
      .setAllowedAuthenticators(allowed)
    // A negative button is required unless device-credential fallback is offered.
    if (allowed and DEVICE_CREDENTIAL == 0) builder.setNegativeButtonText("Cancel")
    val promptInfo = builder.build()

    activity.runOnUiThread {
      val prompt = BiometricPrompt(
        activity,
        ContextCompat.getMainExecutor(reactContext),
        object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            promise.resolve(true)
          }

          override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            // Cancels and lockouts are not crashes — report a clean "not unlocked".
            promise.resolve(false)
          }

          override fun onAuthenticationFailed() {
            // A single bad attempt; the prompt stays open, so don't resolve yet.
          }
        },
      )
      prompt.authenticate(promptInfo)
    }
  }
}
