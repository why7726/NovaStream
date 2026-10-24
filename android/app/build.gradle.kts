import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/* Signature : la clé et ses mots de passe vivent HORS du dépôt (fichier
   signature.properties, ignoré par Git). Sans elle, on fabrique seulement
   une version de test (debug). Garder cette clé : sans elle, impossible de
   publier une mise à jour qui s'installe par-dessus l'application. */
val signature = Properties().apply {
    val f = rootProject.file("signature.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "io.github.why7726.novastream"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.why7726.novastream"
        minSdk = 26          // Android 8.0
        targetSdk = 36
        versionCode = 7
        versionName = "0.3.2"
    }

    signingConfigs {
        if (signature.getProperty("fichier") != null) {
            create("nova") {
                storeFile = file(signature.getProperty("fichier"))
                storePassword = signature.getProperty("motDePasse")
                keyAlias = signature.getProperty("alias")
                keyPassword = signature.getProperty("motDePasse")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (signature.getProperty("fichier") != null) signingConfig = signingConfigs.getByName("nova")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    val media3 = "1.11.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.media3:media3-datasource:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")   // qualité réduite : flux transcodé du serveur
    // Décodeurs FFmpeg pour ExoPlayer (AC3, EAC3, DTS, TrueHD… que beaucoup
    // de téléphones ne savent pas lire) : la même idée que mpv sur Windows.
    implementation("io.github.anilbeesetti:nextlib-media3ext:1.11.1-0.16.0")
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    // Préparation des téléchargements en arrière-plan, même application fermée
    implementation("androidx.work:work-runtime-ktx:2.12.0")
}
