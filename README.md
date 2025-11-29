# DFU Integration Assistant

A VS Code chat participant that guides you through DMIU (Development Feature Unlocking) integration with interactive Q&A and automatic adapter generation.

## Features

- **Interactive Integration** - Multi-step wizard for POSIX/AUTOSAR deployment
- **Conversation State** - Maintains context across multiple messages
- **Workspace Analysis** - Auto-detects platform and existing functions
- **Adapter Generation** - Creates wrapper functions for incompatible signatures
- **Slash Commands** - `/integrate`, `/validate`, `/adapter` for specific tasks

## Usage

### Start Integration

In GitHub Copilot Chat, type:

```
@dfu /integrate posix
```

or

```
@dfu /integrate autosar
```

The assistant will guide you through 3 steps:
1. **Memory allocation** - Choose function (ShmM_MapOwner, static, or custom)
2. **Dataset loading** - Specify function that loads debug config
3. **Alternative source** - Optional alternative debug level source

### Validate Integration

```
@dfu /validate
```

Checks for existing integration files in your workspace.

### Generate Adapter

```
@dfu /adapter MyFunction
```

Creates adapter function for incompatible signatures.

### Get Help

```
@dfu
```

Shows DFU/DMIU overview and available commands.

## How It Works

The chat participant:
1. Analyzes your workspace for existing DMIU integration
2. Detects platform (POSIX/AUTOSAR) from build files
3. Finds memory allocation and dataset functions
4. Asks you 3 questions about your specific setup
5. Generates complete integration files with adapters
6. Maintains conversation state for follow-up questions

## Example Workflow

```
You: @dfu /integrate posix

@dfu: Starting POSIX Integration
      
      Step 1/3: Memory Allocation
      Which function should I use?
      - ShmM_MapOwner - Shared memory (recommended)
      - static - Static global variable
      
You: ShmM_MapOwner

@dfu: ✅ Memory: ShmM_MapOwner
      
      Step 2/3: Dataset Loading
      Which function loads debug configuration?
      
You: MyCustomReader (returns string "level_1" or "level_2")

@dfu: ✅ Dataset: MyCustomReader
      
      Step 3/3: Alternative Load
      Which function provides alternative debug level?
      
You: none

@dfu: ✅ Alternative: none
      
      Generating Integration Files...
      
      [Complete code for dmiu_integration.h, dmiu_integration.c, main.c]
      
      ✅ Integration complete!
```

## Requirements

- VS Code 1.106.1 or higher
- GitHub Copilot subscription
- GitHub Copilot Chat extension

## Customization

The assistant automatically:
- Detects your platform from workspace files
- Finds existing memory/dataset functions
- Creates adapters for type mismatches
- Includes TTTech Auto copyright headers
- Adds MISRA justifications
- Generates Doxygen documentation

## Development

### Compiling

```bash
npm run compile
```

### Testing

1. Press `F5` to launch Extension Development Host
2. Open GitHub Copilot Chat (`Ctrl+Alt+I`)
3. Type `@dfu` to start using the assistant

## Release Notes

### 0.0.1

Initial release:
- Chat participant for DMIU integration
- Interactive 3-step workflow
- Workspace analysis
- Automatic adapter generation
- Support for POSIX and AUTOSAR platforms
