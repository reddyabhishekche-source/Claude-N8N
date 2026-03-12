# QA Test Design Agent — n8n Workflow

Automated QA test case design agent that analyzes JIRA stories, reviews existing Zephyr test cases, identifies coverage gaps, generates new test cases using Claude, and links them back to the story.

## Workflow Overview

```
Chat Trigger → Extract Story ID → Fetch JIRA Story → Parse JIRA Story
    → Fetch Zephyr Test Cases → Filter Linked Test Cases
    → Analyze Coverage (Claude) → Parse Coverage Analysis
    → Generate New Test Cases (Claude) → Parse New Test Cases
    → Create Zephyr Test Case → Extract Test Case Key
    → Link Test Case to Story → Build Final Output
    → Format Response (Claude)
```

## Setup

### 1. Import the Workflow

Import `qa_test_design_agent.json` into your n8n instance via **Workflows → Import from file**.

### 2. Configure Credentials

#### JIRA Basic Auth (`jira-basic-auth`)
- **Username**: Your JIRA email address
- **Password**: Your JIRA API token ([generate here](https://id.atlassian.com/manage-profile/security/api-tokens))

#### Anthropic API (`anthropic-api-cred`)
- **API Key**: Your Anthropic API key ([console.anthropic.com](https://console.anthropic.com))

### 3. Configure n8n Variables

Set the following variables in **Settings → Variables**:

| Variable | Description | Example |
|---|---|---|
| `JIRA_DOMAIN` | Your JIRA cloud domain | `yourcompany.atlassian.net` |
| `ZEPHYR_API_TOKEN` | Zephyr Scale API token | `eyJ...` |

To get your Zephyr API token: JIRA → Apps → Zephyr Scale → API Access Tokens.

### 4. Update Owner ID (Optional)

In the **Create Zephyr Test Case** node, update the `owner` field with your JIRA account ID:

```json
"owner": "712020:your-account-id-here"
```

Find your account ID via: `GET /rest/api/3/myself`

## Usage

Trigger the workflow by sending a chat message with just the JIRA story ID:

```
SCRUM-123
```

## Output

The agent returns a structured summary including:

- **Story overview** — ID and summary
- **Coverage summary** — What functional, edge case, validation, and negative scenarios already exist
- **Missing scenarios** — Gaps identified with categories (boundary, negative, validation, error_handling, integration, functional)
- **New test cases created** — Zephyr test case keys and names for all newly created cases
- **Overall assessment** — High-level QA coverage health

## Node Descriptions

| Node | Purpose |
|---|---|
| Chat Message Trigger | Receives the JIRA Story ID from chat |
| Extract Story ID | Validates and parses the story ID (e.g. SCRUM-123) |
| Fetch JIRA Story | Calls JIRA REST API to get story details |
| Parse JIRA Story | Extracts summary, description, and acceptance criteria from ADF format |
| Fetch Zephyr Test Cases | Retrieves all test cases for the project from Zephyr Scale |
| Filter Linked Test Cases | Filters only test cases linked to the target story |
| Analyze Coverage (Claude) | Uses Claude to identify covered and missing scenarios |
| Parse Coverage Analysis | Parses Claude's JSON response for coverage data |
| Generate New Test Cases (Claude) | Uses Claude to generate structured test cases for gaps |
| Parse New Test Cases | Parses Claude's JSON array of new test cases |
| Create Zephyr Test Case | POSTs each new test case to Zephyr Scale API |
| Extract Test Case Key | Pulls the new test case key from Zephyr response |
| Link Test Case to Story | Links the new test case to the JIRA story |
| Build Final Output | Aggregates all results into structured JSON |
| Format Response (Claude) | Produces a human-readable summary |

## Zephyr API Reference

- **Base URL**: `https://prod-api.zephyr4jiracloud.com/v2`
- **Auth**: Bearer token in `Authorization` header
- **Status ID**: `11845307` (Draft) — update to match your project's status IDs
- **Priority ID**: `11845309` (Medium) — update to match your project's priority IDs

To find your project's status and priority IDs:
```
GET https://prod-api.zephyr4jiracloud.com/v2/statuses?projectKey=SCRUM
GET https://prod-api.zephyr4jiracloud.com/v2/priorities?projectKey=SCRUM
```

## Rules Enforced

- No duplicate test cases (existing test case names are passed to Claude as context)
- Only creates test cases for missing coverage
- Steps are atomic and include expected results
- Each test case has name, objective, precondition, and steps
