export const GenerateRef = function (num: number, type: string): string {
    // let unique_code = GenerateRandomString(num)
    let unique_code = num.toString();
    let zero_count = 0;
    if (unique_code.length < 7) {
        zero_count = 7 - unique_code.length;
        unique_code = '0'.repeat(zero_count) + unique_code;
    }

    return type + 'B' + unique_code;
};

export const GenerateRandomString = function (length: number): string {
    let result = '';
    const characters =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
};


export function generateMRN(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 9; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export function generateSessionCode(): string {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';

    // Add 3 random uppercase letters
    for (let i = 0; i < 3; i++) {
        result += letters.charAt(Math.floor(Math.random() * letters.length));
    }

    // Add 3 random digits
    for (let i = 0; i < 3; i++) {
        result += Math.floor(Math.random() * 10).toString();
    }

    return result;
}
