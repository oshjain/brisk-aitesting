# AI Prompts

This page explains how `brisk-aitesting` builds prompts for AI planning.

## Short Answer

`brisk-aitesting` uses built-in SDK prompts for safety and structure.

Host apps can add their own product instructions, but they do not replace the SDK safety prompts.

## Prompt Layers

| Layer | Owned by | Location | Can host override it? | Purpose |
|:------|:---------|:---------|:----------------------|:--------|
| Core planning system prompt | SDK | `src/ai-planner.ts` | No | Forces JSON plans, no executable code, supported scenario types, route provenance, workflow captures, and safe planning rules |
| Repair system prompt | SDK | `src/ai-planner.ts` | No | Repairs invalid plans after validation fails |
| UI action grounding prompt | SDK | `src/ai-planner.ts` | No | Converts UI intent into grounded actions using observed UI evidence IDs |
| User prompt payload | SDK | `src/ai-planner.ts` | Partly, through run input | Sends goal, scenario count, count policy, mode, required types, app config, discovery, and expected output shape |
| Host application instructions | Host app | Host integration code | Yes | Adds product-specific rules, credentials guidance, domain language, and local app constraints |

## Why Some Prompts Are Built In

The SDK prompt is built in because these rules must not be casually removed:

- AI returns JSON plans, not TypeScript or Playwright code.
- AI does not execute arbitrary code.
- AI cannot claim a target is user-supplied.
- UI actions must use grounded evidence IDs.
- API routes must come from discovery, contracts, or explicit host input.
- Workflow variables must be captured before use.
- Scenario count can be enforced by the host.
- The validator can reject or repair bad plans before engines run.

Host apps should customize product context, not remove the safety contract.

## Where The Built-In Prompts Are Defined

Source file:

```text
src/ai-planner.ts
```

Main functions:

```text
buildSystemPrompt()
buildRepairSystemPrompt()
buildUiActionEnrichmentSystemPrompt()
buildUserPrompt(context)
buildRepairUserPrompt(context)
buildUiActionEnrichmentUserPrompt(context)
```

## What A Host App Can Control

Host apps control prompt behavior through the run input and provider bridge.

Common controls:

| Control | Where it comes from | What it changes |
|:--------|:--------------------|:----------------|
| `goal` | User or host UI | What should be tested |
| `scenarios` | User or host UI | Requested scenario count |
| `scenarioCountPolicy` | Host integration | Whether the count is exact or flexible |
| `mode` | User or host UI | Automatic, UI, API, contract, schema, replay, message, custom |
| `requiredTypes` | Host integration | Forces at least one scenario of selected engine types |
| `uiActionFeedback` | Host integration | Whether UI actions are grounded before execution |
| Host prompt | Host settings/config | Product-specific instructions appended to the SDK prompt |
| AI max tokens | Host settings/config | Output budget for generated JSON |
| Repair attempts | Host settings/config | How many times invalid AI output can be repaired |

## Example SDK User Prompt Payload

This is the kind of JSON payload the SDK sends as the user message to the AI provider.

```json
{
  "goal": "Test publisher, topic, message, playground, and monitoring workflows",
  "scenarios": 15,
  "scenarioCountPolicy": "exact",
  "mode": "automatic",
  "requiredTypes": [],
  "app": {
    "name": "Host SaaS",
    "baseUrl": "http://127.0.0.1:3000",
    "repoPath": ".",
    "env": "local"
  },
  "discovery": {
    "uiRoutes": [
      { "path": "/playground", "source": "runtime", "confidence": 0.9 }
    ],
    "apiRoutes": [
      { "method": "POST", "path": "/api/topics/:topicId/messages", "source": "repo", "confidence": 0.8 }
    ],
    "contracts": [],
    "repoSignals": []
  },
  "planningRules": {
    "scenarioCount": "Return exactly 15 scenarios. Do not return fewer or more."
  },
  "outputShape": {
    "mode": "automatic",
    "warnings": [],
    "scenarios": [
      {
        "name": "Scenario name",
        "type": "api",
        "objective": "What this proves",
        "target": {
          "method": "POST",
          "path": "/api/topics/<topicId>/messages",
          "sourceOfTruth": "observed"
        },
        "request": {
          "body": { "text": "message-<unique>" }
        },
        "expect": { "status": 201 },
        "capture": [
          { "name": "messageId", "from": "response.body", "path": "id" }
        ],
        "assertions": ["message is published"],
        "evidenceRequired": ["api"]
      }
    ]
  }
}
```

## Example Host Prompt

A host app can append product-specific instructions like this:

```text
Host application instructions:
Use the configured test login only for authentication scenarios.
Prefer API tests for backend behavior.
Use UI tests only when page navigation, forms, or visible behavior must be verified.
For publisher/topic/message workflows, capture IDs from create responses before using them.
Do not invent routes. Use only discovered routes, contract routes, or explicit host targets.
```

## Example Final Message Shape

The AI provider receives messages like this:

```json
[
  {
    "role": "system",
    "content": "SDK core planning prompt\n\nHost application instructions:\n..."
  },
  {
    "role": "user",
    "content": "{ \"goal\": \"...\", \"scenarios\": 15, \"discovery\": { ... } }"
  }
]
```

## Brisk Host App Example

In the BRISK app, the Testing settings prompt is appended as host instructions.

BRISK source file:

```text
packages/server/src/domains/testing-aitesting.ts
```

Config key:

```text
testing_ai_prompt
```

That setting does not replace the SDK prompt. It is appended after the SDK system prompt.

## Current Design Rule

The SDK owns safety.

The host app owns product context.

The validator decides whether the final plan is allowed to run.

