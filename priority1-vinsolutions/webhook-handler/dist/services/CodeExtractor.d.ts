import { CodeExtractionResult } from '../types';
export declare class CodeExtractor {
    private openai;
    private logger;
    constructor(apiKey: string, baseURL?: string);
    extractCode(emailSubject: string, emailBody: string, sender: string): Promise<CodeExtractionResult>;
    private extractWithAI;
    private extractWithRegex;
    private identifyPlatform;
}
//# sourceMappingURL=CodeExtractor.d.ts.map