import fs from 'fs';
import path from 'path';
import { serializeKey } from '@/assets/utils';
export function saveAssetsToFile(data: any, fileName: string) {
    const outputDir = path.join(__dirname, 'output');
    fs.mkdirSync(outputDir, { recursive: true });

        fs.writeFileSync(
            path.join(outputDir, fileName),
            JSON.stringify(
                Object.fromEntries(data),
                (_, value) => typeof value === 'bigint' ? value.toString() : value,
                2
            )
        );
}

//save to a file using serializeKey
export function saveToFile(data: any, fileName: string) {
    const outputDir = path.join(__dirname, 'output');
    fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(path.join(outputDir, fileName), serializeKey(data));
}
