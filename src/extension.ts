// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';

/**********************************************************************************************************************
 *  TYPES AND INTERFACES
 *********************************************************************************************************************/

/** Conversation state for multi-turn interactions */
interface ConversationState {
	step: 'initial' | 'config' | 'memory' | 'dataset' | 'alternative' | 'complete';
	platform?: 'posix' | 'autosar';
	motionwiseConfig?: MotionWiseConfig;
	integrationPath?: string;
	memoryFunction?: string;
	datasetFunction?: string;
	alternativeFunction?: string;
}

/** Workspace analysis results */
interface WorkspaceAnalysis {
	detectedPlatform?: 'posix' | 'autosar';
	detectedMotionWiseConfig?: MotionWiseConfig;
	memoryFunctions: string[];
	datasetFunctions: string[];
	existingIntegrationFiles: string[];
}

/** MotionWise configuration types */
type MotionWiseConfig = 'cp-rdb2' | 'cp-rdb3' | 'sv62' | 's324sdv' | 'ch63_2' | 'generic' | 'unknown';

/**********************************************************************************************************************
 *  DFU KNOWLEDGE BASE
 *********************************************************************************************************************/

const DFU_KNOWLEDGE = `# DFU (Development Feature Unlocking) Overview

## What is DFU/DMIU?

DFU (Development Feature Unlocking Service), also known as DMIU (Development Mode Initialization Unit), enables different debug levels:
- **Debug Level 1** - Basic debugging features
- **Debug Level 2** - Advanced debugging features  
- **Safe Level** - Production mode (no debug features)

## Architecture

- **Core (1200-Core)**: Platform-agnostic logic (common for all configurations)
- **Integration Layer**: Platform-specific handwritten code

## Initialization

Call \`DMIU_Initialize(config_struct)\` where config has three attributes:
1. **target_memory**: Pointer to struct with two uint32 (MagicFlagA, MagicFlagB)
2. **dataset_read_func**: Function to load from persistent storage
3. **debug_level_override_func**: Alternative source with OR logic

## Platform-Specific Initialization

- **AUTOSAR**: Call from PreOS.c startup sequence
- **POSIX**: Run dmiu daemon, main() from integration layer

## Client API

\`\`\`c
#include "Debug_Mode.h"
if (Dmiu_IsDebugLevel1Active()) { /* basic debug */ }
if (Dmiu_IsDebugLevel2Active()) { /* advanced debug */ }
// If neither active → Safe Level (production)
\`\`\`

## Magic Flag Values

\`\`\`c
// DEBUG_LEVEL_SAFE: 0x00000000, 0x00000000
// DEBUG_LEVEL_1:    0xDEB00001, 0xDEB00001
// DEBUG_LEVEL_2:    0xDEB00002, 0xDEB00002
\`\`\`
`;

const MOTIONWISE_CONTEXT = `## MotionWise Platform Architecture

### Build System
- MotionWise uses **BAZEL** as build system
- Top level build file: \`1500-build/BUILD.bazel\`
- Uses GENIE framework for code generation ("wishes")
- Close to 200 git repositories

### Repository Structure
- **1200-Core**: Platform-agnostic services (common for all)
- **1900-sysdef**: Manual configuration input (CP, s324sdv, SV62)
- **1700-Configuration**: Generated configuration output
- **1800-EcuIntegration** or **1710-handwritten-config**: Handwritten platform-specific code

### DMIU Integration Paths by Configuration

| Configuration | Board | Integration Path |
|--------------|-------|------------------|
| CP | RDB2 | \`1800-EcuIntegration/RDB2/1800-ecu-int-rdb2-cp-a/core/development/dmiu\` |
| CP | RDB3 | \`1800-EcuIntegration/RDB3/1800-ecu-int-rdb3-cp-a/core/development/dmiu\` |
| SV62 (HCP2MEJ) | RDB2 | \`1700-Configuration/RDB2/1710-handwritten-config-sv62/core/development/dmiu\` |
| s324sdv (SDV) | RDB2 | \`1700-Configuration/RDB2/1710-handwritten-config-s324sdv/core/development/dmiu\` |
| CH63_2 | - | \`configs/projects/CH63_2/deployments/1710-handwritten-config-ch63_2/core/development/dmiu\` |

**Note:** s324sdv has two ECU configurations (corner case).
`;

/** Integration path mapping for MotionWise configs */
const MOTIONWISE_PATHS: Record<MotionWiseConfig, string> = {
	'cp-rdb2': '1800-EcuIntegration/RDB2/1800-ecu-int-rdb2-cp-a/core/development/dmiu',
	'cp-rdb3': '1800-EcuIntegration/RDB3/1800-ecu-int-rdb3-cp-a/core/development/dmiu',
	'sv62': '1700-Configuration/RDB2/1710-handwritten-config-sv62/core/development/dmiu',
	's324sdv': '1700-Configuration/RDB2/1710-handwritten-config-s324sdv/core/development/dmiu',
	'ch63_2': 'configs/projects/CH63_2/deployments/1710-handwritten-config-ch63_2/core/development/dmiu',
	'generic': '1800-EcuIntegration/[PLATFORM]/core/development/dmiu',
	'unknown': '1800-EcuIntegration/[PLATFORM]/core/development/dmiu'
};

/**********************************************************************************************************************
 *  ACTIVATION
 *********************************************************************************************************************/

export function activate(context: vscode.ExtensionContext) {
	console.log('DFU Chat Participant is now active!');

	// Store conversation states by history length (simple session tracking)
	const conversationStates = new Map<number, ConversationState>();

	// Register chat participant
	const participant = vscode.chat.createChatParticipant('dfu.assistant', async (
		request: vscode.ChatRequest,
		chatContext: vscode.ChatContext,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	) => {
		// Get or create conversation state based on history length
		const sessionKey = chatContext.history.length;
		let state = conversationStates.get(sessionKey) || conversationStates.get(sessionKey - 1);
		if (!state) {
			state = { step: 'initial' };
		}
		conversationStates.set(sessionKey + 1, state);

		try {
			// Handle slash commands
			if (request.command === 'integrate') {
				await handleIntegrateCommand(request, stream, state, token);
			} else if (request.command === 'validate') {
				await handleValidateCommand(stream, token);
			} else if (request.command === 'adapter') {
				await handleAdapterCommand(request, stream, token);
			} else {
				// No command - continue conversation flow
				await handleConversationFlow(request, chatContext, stream, state, token);
			}
		} catch (error) {
			stream.markdown(`\n\n❌ Error: ${error instanceof Error ? error.message : String(error)}\n`);
		}
	});

	// Set participant metadata
	participant.iconPath = new vscode.ThemeIcon('circuit-board');

	context.subscriptions.push(participant);
}

/**********************************************************************************************************************
 *  COMMAND HANDLERS
 *********************************************************************************************************************/

async function handleIntegrateCommand(
	request: vscode.ChatRequest,
	stream: vscode.ChatResponseStream,
	state: ConversationState,
	token: vscode.CancellationToken
): Promise<void> {
	const input = request.prompt.trim().toLowerCase();
	
	// Check if platform specified
	if (input !== 'posix' && input !== 'autosar' && input !== 'motionwise') {
		stream.markdown('## DFU Integration\n\n');
		stream.markdown('Please specify platform:\n\n');
		stream.markdown('- `posix` - Generic POSIX platform\n');
		stream.markdown('- `autosar` - Generic AUTOSAR platform\n');
		stream.markdown('- `motionwise` - MotionWise platform (auto-detects configuration)\n\n');
		stream.markdown('**Example:** `@dfu /integrate motionwise`\n');
		return;
	}

	state.platform = (input === 'posix' || input === 'autosar') ? input : 'posix';
	
	// Analyze workspace
	const analysis = await analyzeWorkspace();
	
	stream.markdown(`## Starting ${input.toUpperCase()} Integration\n\n`);
	
	// If MotionWise, detect configuration
	if (input === 'motionwise') {
		stream.markdown(MOTIONWISE_CONTEXT + '\n\n');
		
		if (analysis.detectedMotionWiseConfig && analysis.detectedMotionWiseConfig !== 'unknown') {
			state.motionwiseConfig = analysis.detectedMotionWiseConfig;
			state.integrationPath = MOTIONWISE_PATHS[analysis.detectedMotionWiseConfig];
			stream.markdown(`✅ Detected configuration: **${analysis.detectedMotionWiseConfig.toUpperCase()}**\n`);
			stream.markdown(`📁 Integration path: \`${state.integrationPath}\`\n\n`);
			state.step = 'memory';
		} else {
			// Ask user to specify configuration
			stream.markdown('### Which MotionWise configuration are you using?\n\n');
			stream.markdown('Available configurations:\n');
			stream.markdown('1. `cp-rdb2` - CP on RDB2 board\n');
			stream.markdown('2. `cp-rdb3` - CP on RDB3 board\n');
			stream.markdown('3. `sv62` - SV62 (HCP2MEJ) on RDB2\n');
			stream.markdown('4. `s324sdv` - s324sdv (SDV) on RDB2\n');
			stream.markdown('5. `ch63_2` - CH63_2 configuration\n');
			stream.markdown('6. `generic` - Generic/custom configuration\n\n');
			stream.markdown('💬 **Reply with configuration name** (e.g., "cp-rdb2")\n');
			state.step = 'config';
			return;
		}
	} else {
		state.step = 'memory';
		state.integrationPath = '1800-EcuIntegration/[PLATFORM]/core/development/dmiu';
	}

	// Show file structure
	stream.markdown('### Files to be created:\n\n');
	stream.markdown('```\n');
	stream.markdown(`${state.integrationPath}/\n`);
	stream.markdown(`├── api/dmiu_integration.h\n`);
	stream.markdown(`└── src/\n`);
	stream.markdown(`    ├── dmiu_integration.c\n`);
	if (state.platform === 'posix') {
		stream.markdown(`    └── main.c\n`);
	}
	stream.markdown('```\n\n');

	// Ask first question
	stream.markdown('### Step 1/3: Memory Allocation\n\n');
	stream.markdown('Which function should I use for memory allocation?\n\n');
	
	if (analysis.memoryFunctions.length > 0) {
		stream.markdown('**Found in workspace:**\n');
		analysis.memoryFunctions.forEach((fn, i) => {
			stream.markdown(`${i + 1}. \`${fn}\`\n`);
		});
		stream.markdown('\n');
	}
	
	stream.markdown('**Options:**\n');
	if (state.platform === 'posix') {
		stream.markdown('- `ShmM_MapOwner` - Shared memory (recommended)\n');
	}
	stream.markdown('- `static` - Static global variable\n');
	stream.markdown('- Or provide your custom function name\n\n');
	stream.markdown('💬 **Just reply with your choice**\n');
}

async function handleValidateCommand(
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken
): Promise<void> {
	const analysis = await analyzeWorkspace();
	
	stream.markdown('## DMIU Integration Validation\n\n');
	
	if (analysis.existingIntegrationFiles.length === 0) {
		stream.markdown('❌ No integration files found\n\n');
		stream.markdown('Run `@dfu /integrate posix` or `@dfu /integrate autosar` to start.\n');
		return;
	}
	
	stream.markdown('### Found Integration Files:\n\n');
	analysis.existingIntegrationFiles.forEach(file => {
		stream.markdown(`✅ ${file}\n`);
	});
}

async function handleAdapterCommand(
	request: vscode.ChatRequest,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken
): Promise<void> {
	const functionName = request.prompt.trim();
	
	if (!functionName) {
		stream.markdown('Please provide a function name.\n\n');
		stream.markdown('**Example:** `@dfu /adapter MyDatasetFunction`\n');
		return;
	}
	
	stream.markdown(`## Generating Adapter for \`${functionName}\`\n\n`);
	stream.markdown('What does this function return?\n\n');
	stream.markdown('- String (e.g., "debug_level_2")\n');
	stream.markdown('- Integer (0/1/2)\n');
	stream.markdown('- Boolean\n');
	stream.markdown('- Compatible type\n');
}

async function handleConversationFlow(
	request: vscode.ChatRequest,
	chatContext: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	state: ConversationState,
	token: vscode.CancellationToken
): Promise<void> {
	const userMessage = request.prompt.trim();

	if (state.step === 'initial') {
		stream.markdown(DFU_KNOWLEDGE);
		stream.markdown('\n\n💡 **Get started:** `@dfu /integrate posix` or `@dfu /integrate autosar` or `@dfu /integrate motionwise`\n');
		return;
	}

	if (state.step === 'config') {
		// User selected MotionWise configuration
		const configMap: Record<string, MotionWiseConfig> = {
			'1': 'cp-rdb2',
			'2': 'cp-rdb3',
			'3': 'sv62',
			'4': 's324sdv',
			'5': 'ch63_2',
			'6': 'generic'
		};
		
		const selectedConfig = configMap[userMessage] || userMessage.toLowerCase() as MotionWiseConfig;
		
		if (selectedConfig && MOTIONWISE_PATHS[selectedConfig]) {
			state.motionwiseConfig = selectedConfig;
			state.integrationPath = MOTIONWISE_PATHS[selectedConfig];
			state.step = 'memory';
			
			stream.markdown(`✅ Configuration: **${selectedConfig}**\n\n`);
			stream.markdown(`📁 Integration path: \`${state.integrationPath}\`\n\n`);
			stream.markdown('### Step 1/3: Memory Management\n\n');
			stream.markdown('Which function provides memory pointer?\n\n');
			stream.markdown('Requirements:\n');
			stream.markdown('- Returns void* to memory region\n');
			stream.markdown('- Persistent memory for DMIU config\n');
			stream.markdown('- Compatible type\n\n');
			stream.markdown('💬 **Reply with function name**\n');
		} else {
			stream.markdown('❌ Invalid configuration. Please choose 1-6 or type the config name.\n');
		}
		return;
	}

	if (state.step === 'memory') {
		state.memoryFunction = userMessage;
		state.step = 'dataset';
		
		stream.markdown(`✅ Memory: \`${userMessage}\`\n\n`);
		stream.markdown('### Step 2/3: Dataset Loading\n\n');
		stream.markdown('Which function loads debug configuration?\n\n');
		stream.markdown('Provide function name or describe what it returns:\n');
		stream.markdown('- String ("debug_level_1", "debug_level_2", "safe")\n');
		stream.markdown('- Integer (0=safe, 1=level1, 2=level2)\n');
		stream.markdown('- Compatible signature\n\n');
		stream.markdown('💬 **Reply with function name or description**\n');
		return;
	}

	if (state.step === 'dataset') {
		state.datasetFunction = userMessage;
		state.step = 'alternative';
		
		stream.markdown(`✅ Dataset: \`${userMessage}\`\n\n`);
		stream.markdown('### Step 3/3: Alternative Load\n\n');
		stream.markdown('Which function provides alternative debug level?\n\n');
		stream.markdown('Options:\n');
		stream.markdown('- Function name (if you have one)\n');
		stream.markdown('- `none` (stub returning SAFE)\n\n');
		stream.markdown('💬 **Reply with function name or "none"**\n');
		return;
	}

	if (state.step === 'alternative') {
		state.alternativeFunction = userMessage;
		state.step = 'complete';
		
		stream.markdown(`✅ Alternative: \`${userMessage}\`\n\n`);
		stream.markdown('## Generating Integration Files...\n\n');
		
		await generateIntegrationCode(state, stream, token);
		
		stream.markdown('\n\n✅ **Integration complete!**\n\n');
		stream.markdown('Next steps:\n');
		stream.markdown('1. Review generated files\n');
		stream.markdown('2. Compile and test\n');
		stream.markdown('3. Use `@dfu /validate` to check\n');
		
		state.step = 'initial';
		return;
	}
}

/**********************************************************************************************************************
 *  WORKSPACE ANALYSIS
 *********************************************************************************************************************/

async function analyzeWorkspace(): Promise<WorkspaceAnalysis> {
	const result: WorkspaceAnalysis = {
		memoryFunctions: [],
		datasetFunctions: [],
		existingIntegrationFiles: []
	};

	// Check for existing integration files
	const integrationFiles = await vscode.workspace.findFiles(
		'**/1800-EcuIntegration/**/dmiu/**/*.{c,h}',
		'**/node_modules/**',
		10
	);
	
	result.existingIntegrationFiles = integrationFiles.map(uri => 
		vscode.workspace.asRelativePath(uri)
	);

	// Detect MotionWise configuration from workspace paths
	const configPatterns: { pattern: string; config: MotionWiseConfig }[] = [
		{ pattern: '**/1800-ecu-int-rdb2-cp-a/**', config: 'cp-rdb2' },
		{ pattern: '**/1800-ecu-int-rdb3-cp-a/**', config: 'cp-rdb3' },
		{ pattern: '**/1710-handwritten-config-sv62/**', config: 'sv62' },
		{ pattern: '**/1710-handwritten-config-s324sdv/**', config: 's324sdv' },
		{ pattern: '**/1710-handwritten-config-ch63_2/**', config: 'ch63_2' }
	];

	for (const { pattern, config } of configPatterns) {
		const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 1);
		if (files.length > 0) {
			result.detectedMotionWiseConfig = config;
			break;
		}
	}

	// Detect POSIX platform
	const posixFiles = await vscode.workspace.findFiles('**/main.c', '**/node_modules/**', 5);
	for (const file of posixFiles) {
		const content = await vscode.workspace.fs.readFile(file);
		const text = Buffer.from(content).toString('utf8');
		if (text.includes('PFSW_BUILD_OS_POSIX') || text.includes('ShmM')) {
			result.detectedPlatform = 'posix';
			break;
		}
	}

	// Find common functions
	const headerFiles = await vscode.workspace.findFiles('**/*.h', '**/node_modules/**', 100);
	for (const file of headerFiles.slice(0, 50)) {
		const content = await vscode.workspace.fs.readFile(file);
		const text = Buffer.from(content).toString('utf8');
		
		if (text.includes('ShmM_MapOwner') && !result.memoryFunctions.includes('ShmM_MapOwner')) {
			result.memoryFunctions.push('ShmM_MapOwner');
		}
		if (text.includes('Per_DS_Read') && !result.datasetFunctions.includes('Per_DS_ReadDSElementDMIU')) {
			result.datasetFunctions.push('Per_DS_ReadDSElementDMIU');
		}
	}

	return result;
}

/**********************************************************************************************************************
 *  CODE GENERATION
 *********************************************************************************************************************/

async function generateIntegrationCode(
	state: ConversationState,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken
): Promise<void> {
	const prompt = buildCodeGenerationPrompt(state);
	
	const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
	
	if (!models || models.length === 0) {
		stream.markdown('⚠️ Language Model not available\n\n');
		stream.markdown(`Config: Platform=${state.platform}, Memory=${state.memoryFunction}, Dataset=${state.datasetFunction}, Alt=${state.alternativeFunction}\n`);
		return;
	}

	const model = models[0];
	const messages = [
		vscode.LanguageModelChatMessage.User(DFU_KNOWLEDGE),
		vscode.LanguageModelChatMessage.User(prompt)
	];

	const response = await model.sendRequest(messages, {}, token);
	
	for await (const chunk of response.text) {
		stream.markdown(chunk);
	}
}

function buildCodeGenerationPrompt(state: ConversationState): string {
	return `Generate complete DMIU integration for ${state.platform?.toUpperCase()} platform.

Configuration:
- Platform: ${state.platform}
- Memory: ${state.memoryFunction}
- Dataset: ${state.datasetFunction}
- Alternative: ${state.alternativeFunction}

Generate these files with TTTech Auto copyright (2025), MISRA justifications, Doxygen docs:

1. **dmiu_integration.h** - Header with function declarations
2. **dmiu_integration.c** - Implementation with adapters for user's functions
${state.platform === 'posix' ? '3. **main.c** - POSIX daemon entry point' : ''}

Create adapter functions if user's functions don't match required signatures:
- Memory adapter: Cast/wrap to return Dt_RECORD_DebugUnlockingStruct_DMIU*
- Dataset adapter: Convert return type to magic flags (0xDEB00001/0xDEB00002/0x00000000)
- Alternative adapter: Convert to e_Dmiu_Debug_Level with OR logic

Show complete, compilable code for each file.`;
}

export function deactivate() {}
