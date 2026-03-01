// swift-tools-version: 6.2
// Package manifest for the ErnOS macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "ErnOS",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "ErnOSIPC", targets: ["ErnOSIPC"]),
        .library(name: "ErnOSDiscovery", targets: ["ErnOSDiscovery"]),
        .executable(name: "ErnOS", targets: ["ErnOS"]),
        .executable(name: "ernos-mac", targets: ["ErnOSMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.3.0"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.1.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
        .package(url: "https://github.com/steipete/Peekaboo.git", branch: "main"),
        .package(path: "../shared/ErnOSKit"),
        .package(path: "../../Swabble"),
    ],
    targets: [
        .target(
            name: "ErnOSIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "ErnOSDiscovery",
            dependencies: [
                .product(name: "ErnOSKit", package: "ErnOSKit"),
            ],
            path: "Sources/ErnOSDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "ErnOS",
            dependencies: [
                "ErnOSIPC",
                "ErnOSDiscovery",
                .product(name: "ErnOSKit", package: "ErnOSKit"),
                .product(name: "ErnOSChatUI", package: "ErnOSKit"),
                .product(name: "ErnOSProtocol", package: "ErnOSKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/ErnOS.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "ErnOSMacCLI",
            dependencies: [
                "ErnOSDiscovery",
                .product(name: "ErnOSKit", package: "ErnOSKit"),
                .product(name: "ErnOSProtocol", package: "ErnOSKit"),
            ],
            path: "Sources/ErnOSMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "ErnOSIPCTests",
            dependencies: [
                "ErnOSIPC",
                "ErnOS",
                "ErnOSDiscovery",
                .product(name: "ErnOSProtocol", package: "ErnOSKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
