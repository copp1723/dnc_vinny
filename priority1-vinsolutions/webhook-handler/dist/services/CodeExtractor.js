"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeExtractor = void 0;
const openai_1 = __importDefault(require("openai"));
const Logger_1 = require("../utils/Logger");
class CodeExtractor {
    constructor(apiKey, baseURL) {
        this.openai = new openai_1.default({
            apiKey,
            baseURL: baseURL || 'https://openrouter.ai/api/v1'
        });
        this.logger = new Logger_1.Logger('CodeExtractor');
    }
    async extractCode(emailSubject, emailBody, sender) {
        try {
            this.logger.info('Extracting 2FA code from email', {
                sender,
                subject: emailSubject
            });
            const platform = this.identifyPlatform(sender, emailSubject);
            const aiResult = await this.extractWithAI(emailSubject, emailBody, sender, platform);
            if (!aiResult.success || aiResult.confidence < 0.8) {
                const regexResult = this.extractWithRegex(emailBody, emailSubject);
                if (regexResult.success) {
                    return {
                        ...regexResult,
                        platform,
                        reasoning: `AI extraction failed (confidence: ${aiResult.confidence}), used regex fallback`
                    };
                }
            }
            return {
                ...aiResult,
                platform
            };
        }
        catch (error) {
            this.logger.error('Code extraction failed', { error: error.message });
            return {
                success: false,
                confidence: 0,
                platform: 'unknown',
                reasoning: `Extraction failed: ${error.message}`,
                error: error.message
            };
        }
    }
    async extractWithAI(subject, body, sender, platform) {
        const prompt = `You are an expert at extracting 2FA verification codes from emails.

Email Details:
- From: ${sender}
- Subject: ${subject}
- Platform: ${platform}
- Body: ${body}

Task: Extract the 2FA/verification code from this email.

Rules:
1. Look for numeric codes (usually 4-8 digits)
2. Common patterns: "code is 123456", "verification code: 123456", "your code 123456"
3. Ignore phone numbers, dates, or other non-code numbers
4. Return ONLY the numeric code, nothing else
5. If no code found, return "NONE"

Response format: Just the numeric code (e.g., "123456") or "NONE"`;
        try {
            const response = await this.openai.chat.completions.create({
                model: 'anthropic/claude-3.5-sonnet',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 50,
                temperature: 0.1
            });
            const extractedText = response.choices[0]?.message?.content?.trim() || '';
            if (extractedText === 'NONE' || !extractedText) {
                return {
                    success: false,
                    confidence: 0,
                    platform,
                    reasoning: 'AI could not find a verification code in the email'
                };
            }
            const codeMatch = extractedText.match(/^\d{4,8}$/);
            if (!codeMatch) {
                return {
                    success: false,
                    confidence: 0.3,
                    platform,
                    reasoning: `AI returned non-numeric result: ${extractedText}`
                };
            }
            return {
                success: true,
                code: extractedText,
                confidence: 0.95,
                platform,
                reasoning: 'AI successfully extracted verification code'
            };
        }
        catch (error) {
            this.logger.error('AI extraction failed', { error: error.message });
            return {
                success: false,
                confidence: 0,
                platform,
                reasoning: `AI extraction error: ${error.message}`,
                error: error.message
            };
        }
    }
    extractWithRegex(body, subject) {
        const text = `${subject} ${body}`.toLowerCase();
        const patterns = [
            /(?:verification|security|access|login|auth|2fa|two.factor)\s*(?:code|pin)[\s:]*(\d{4,8})/i,
            /(?:code|pin)[\s:]*(?:is|=)[\s]*(\d{4,8})/i,
            /your\s+(?:code|pin)[\s:]*(\d{4,8})/i,
            /(\d{6})/g,
            /(\d{4})/g,
            /(\d{8})/g
        ];
        for (const pattern of patterns) {
            const matches = text.match(pattern);
            if (matches) {
                const code = matches[1] || matches[0];
                if (code && code.length >= 4 && code.length <= 8) {
                    return {
                        success: true,
                        code,
                        confidence: 0.7,
                        platform: 'unknown',
                        reasoning: `Regex pattern matched: ${pattern.source}`
                    };
                }
            }
        }
        return {
            success: false,
            confidence: 0,
            platform: 'unknown',
            reasoning: 'No regex patterns matched'
        };
    }
    identifyPlatform(sender, subject) {
        const senderLower = sender.toLowerCase();
        const subjectLower = subject.toLowerCase();
        const platformPatterns = {
            'vinsolutions': ['vinsolutions', 'coxautoinc'],
            'salesforce': ['salesforce', 'force.com'],
            'hubspot': ['hubspot'],
            'microsoft': ['microsoft', 'outlook', 'office365'],
            'google': ['google', 'gmail'],
            'facebook': ['facebook', 'meta'],
            'linkedin': ['linkedin'],
            'twitter': ['twitter', 'x.com'],
            'github': ['github'],
            'aws': ['amazon', 'aws'],
            'stripe': ['stripe']
        };
        for (const [platform, patterns] of Object.entries(platformPatterns)) {
            for (const pattern of patterns) {
                if (senderLower.includes(pattern) || subjectLower.includes(pattern)) {
                    return platform;
                }
            }
        }
        return 'unknown';
    }
}
exports.CodeExtractor = CodeExtractor;
//# sourceMappingURL=CodeExtractor.js.map