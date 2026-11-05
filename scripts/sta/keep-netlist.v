module fpga_playground (
    input wire A,
    input wire B,
    input wire C,
    output wire Y
);
    (* keep = 1 *) wire AND1_out;
    (* keep = 1 *) wire OR1_out;
    and AND1 (AND1_out, A, B);
    or OR1 (OR1_out, AND1_out, C);
    assign Y = OR1_out;
endmodule
