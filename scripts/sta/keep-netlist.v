module fpga_node_3(input wire A, input wire B, output wire Y);
    and gate_and (Y, A, B);
endmodule

module fpga_node_4(input wire A, input wire B, output wire Y);
    or gate_or (Y, A, B);
endmodule

module fpga_playground (
    input wire A,
    input wire B,
    input wire C,
    output wire Y
);
    (* keep = 1 *) wire AND1_out;
    (* keep = 1 *) wire OR1_out;
    fpga_node_3 node3 (.A(A), .B(B), .Y(AND1_out));
    fpga_node_4 node4 (.A(AND1_out), .B(C), .Y(OR1_out));
    assign Y = OR1_out;
endmodule
