# vector-replay-page-controls Specification

## Purpose

页面矢量录制可选注入浮动控制条：用户可在页面内停止录制、打点检查点，且控制条上的指针事件不进入矢量 NDJSON。归档自 change vector-replay-injected-control-bar。

## Requirements

### Requirement: Page control bar injection is optional

When the user starts page vector replay recording with the `injectPageControls` option enabled (exact transport field name MAY match HTTP body or query as implemented), the system SHALL inject a floating control bar DOM subtree attached to the page document, distinct from the existing inspect overlay root.

#### Scenario: Option disabled preserves current behavior

- **WHEN** the client starts vector replay recording without requesting page controls
- **THEN** the injected script SHALL NOT add the control bar root element to the document

#### Scenario: Option enabled adds control bar

- **WHEN** the client starts vector replay recording with page controls requested
- **THEN** the injected script SHALL append a single identifiable control bar root node to the document (implementation-defined id or data attribute)

### Requirement: Control bar interactions are not recorded as vector replay events

The system SHALL NOT emit `pointermove`, `pointerdown`, `click`, or other user-input replay envelope lines for events whose target is contained within the control bar root subtree (including shadow roots if used).

#### Scenario: Click on control bar stop button

- **WHEN** the user clicks a control rendered inside the control bar root
- **THEN** the vector replay SSE stream SHALL NOT receive a new `click` line caused solely by that interaction

#### Scenario: Pointer move over control bar

- **WHEN** the user moves the pointer over elements inside the control bar root
- **THEN** the vector replay SSE stream SHALL NOT emit `pointermove` lines for that movement

### Requirement: Control bar can stop recording via Core bridge

The system SHALL provide a mechanism (such as a dedicated `Runtime.addBinding` for UI commands) for the injected page script to request **stop** of the active page recording for the current session and target, without embedding Bearer tokens in the page.

#### Scenario: Stop command ends active recording

- **WHEN** the page invokes the UI command bridge with a payload equivalent to stop for the active recording
- **THEN** Core SHALL stop the page recording for that `sessionId` and `targetId` such that subsequent vector replay SSE subscribers observe the same end state as today’s `POST .../replay/recording/stop`

### Requirement: Assertion checkpoint signal

The system SHALL allow the user to trigger an **assertion checkpoint** from the control bar (or equivalent control) that produces a machine-readable event on the vector replay SSE stream for downstream LLM or artifact tooling.

#### Scenario: Checkpoint emits structured line

- **WHEN** the user triggers the assertion checkpoint action from the control bar
- **THEN** subscribers to the vector replay SSE SHALL receive one JSON line whose `type` field is `assertion_checkpoint` (or a name documented in schema) and that includes a monotonic `ts` field

### Requirement: Cleanup removes control bar and listeners

When page recording stops or the injected script cleanup runs, the system SHALL remove the control bar from the DOM and unregister related listeners or bindings introduced for page controls, without leaking duplicate bars on restart.

#### Scenario: After stop cleanup

- **WHEN** recording cleanup executes for the target
- **THEN** the control bar root node SHALL no longer be present in the document
